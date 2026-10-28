import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import routes from "./routes/index.js";
import seedDemoUsers from "./seedDemoUsers.js";
import User from "./models/User.js";
import { BusinessCase } from "./models/Business.js";
import { verifyToken } from "./utils/jwt.js";
import { startWorker } from "./utils/businessService.js";
import { statusPage } from "./statusPage.js";

// Connect to database
await connectDB();
await seedDemoUsers();
startWorker();
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5002;

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",");
const corsOptions = { origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] };
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));

// API Routes
app.use("/api", routes);
app.use((error, _req, res, _next) => {
  const status = error.status || (error.name === "ValidationError" ? 422 : error.code === 11000 ? 409 : 500);
  res.status(status).json({ message: status < 500 ? error.message : "Satya service could not complete this request" });
});

// Base route
app.get("/", (req, res) => {
  if (req.accepts("text/html")) return res.type("html").send(statusPage());
  res.json({ service: "satya-business-api" });
});

// Create HTTP server + Socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: corsOptions });

// Track active sockets for direct call notifications
app.set("io", io);
io.use(async (socket, next) => {
  try {
    const decoded = verifyToken(socket.handshake.auth.token);
    const user = await User.findById(decoded.id).select("companyId active");
    if (!user?.active || !user.companyId || user.companyId !== decoded.companyId || decoded.domain !== "satya-business-v1") throw new Error("Membership required");
    socket.data.companyId = user.companyId;
    next();
  } catch { next(new Error("Authentication required")); }
});
io.on("connection", (socket) => {
  socket.on("case:subscribe", async ({ caseId } = {}) => {
    if (typeof caseId !== "string" || caseId.length > 80 || socket.rooms.size > 10) return;
    try {
      if (await BusinessCase.exists({ companyId: socket.data.companyId, id: caseId })) socket.join(`company:${socket.data.companyId}:case:${caseId}`);
    } catch { socket.emit("case:error", { message: "Case subscription unavailable" }); }
  });
});

// Start server
httpServer.listen(PORT, () => console.log(`Satya business API listening on port ${PORT}`));
