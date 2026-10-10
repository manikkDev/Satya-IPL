import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import routes from "./routes/index.js";
import seedDemoUsers from "./seedDemoUsers.js";

// Connect to database
await connectDB();
await seedDemoUsers();

const app = express();
const PORT = process.env.PORT || 5002;

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api", routes);

// Base route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Create HTTP server + Socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Track active sockets for direct call notifications
const userSocketMap = new Map();
const roomMembers = new Map();
app.set("io", io);
app.set("userSocketMap", userSocketMap);

io.on("connection", (socket) => {
  socket.on("fl:subscribe", ({ runId } = {}) => runId && socket.join(`fl:${runId}`));
  socket.on("fl:unsubscribe", ({ runId } = {}) => runId && socket.leave(`fl:${runId}`));

  socket.on("register-user", ({ userId, role, name } = {}) => {
    if (userId) {
      userSocketMap.set(String(userId), socket.id);
      socket.data.userId = String(userId);
      socket.data.role = role;
      socket.data.name = name;
    }
  });

  socket.on("join-room", ({ roomId, userId, role, name } = {}, callback) => {
    if (!roomId) return;
    const roomKey = String(roomId);
    socket.join(roomKey);

    if (userId) {
      userSocketMap.set(String(userId), socket.id);
      socket.data.userId = String(userId);
      socket.data.role = role;
      socket.data.name = name;
    }

    const members = roomMembers.get(roomKey) || new Set();
    const existingSocketId =
      Array.from(members).find((id) => id !== socket.id) || null;
    members.add(socket.id);
    roomMembers.set(roomKey, members);

    if (typeof callback === "function") {
      callback({ existingSocketId });
    }

    socket.to(roomKey).emit("user-joined", { socketId: socket.id, name, role });
  });

  socket.on("offer", ({ roomId, offer, to }) => {
    if (to) {
      io.to(to).emit("offer", { from: socket.id, offer });
      return;
    }
    if (roomId) {
      socket.to(String(roomId)).emit("offer", { from: socket.id, offer });
    }
  });

  socket.on("answer", ({ roomId, answer, to }) => {
    if (to) {
      io.to(to).emit("answer", { from: socket.id, answer });
      return;
    }
    if (roomId) {
      socket.to(String(roomId)).emit("answer", { from: socket.id, answer });
    }
  });

  socket.on("ice-candidate", ({ roomId, candidate, to }) => {
    if (to) {
      io.to(to).emit("ice-candidate", { from: socket.id, candidate });
      return;
    }
    if (roomId) {
      socket
        .to(String(roomId))
        .emit("ice-candidate", { from: socket.id, candidate });
    }
  });

  socket.on("leave-room", ({ roomId }) => {
    if (!roomId) return;
    const roomKey = String(roomId);
    socket.leave(roomKey);
    const members = roomMembers.get(roomKey);
    if (members) {
      members.delete(socket.id);
      if (!members.size) {
        roomMembers.delete(roomKey);
      } else {
        roomMembers.set(roomKey, members);
      }
    }
    socket.to(roomKey).emit("user-left", { socketId: socket.id });
  });

  socket.on("disconnect", () => {
    const userId = socket.data?.userId;
    if (userId && userSocketMap.get(userId) === socket.id) {
      userSocketMap.delete(userId);
    }
    roomMembers.forEach((members, roomId) => {
      if (members.has(socket.id)) {
        members.delete(socket.id);
        if (!members.size) {
          roomMembers.delete(roomId);
        } else {
          roomMembers.set(roomId, members);
        }
        socket.to(roomId).emit("user-left", { socketId: socket.id });
      }
    });
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
