// app.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import geminiRouter from "./routers/geminiRouter.js";
import userRouter from "./routers/userRouter.js";
import chatRouter from "./routers/chatRouter.js";
import speechRouter from "./routers/speechRouter.js";
import { createUploadsDir } from "./utils/fileUpload.js";
import uploadRouter from "./routers/uploadRouter.js";
import feedbackRouter from "./routers/feedbackRouter.js";
import proxyRouter from "./routers/proxyRouter.js";
import flRouter from "./routes/flRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
//env
const envPaths = [
  join(__dirname, '..', '.env'),
  join(__dirname, '.env'),
  join(process.cwd(), '.env')
];
// cuhhh

let envLoaded = false;
for (const envPath of envPaths) {
  try {
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      console.log('Successfully loaded .env from:', envPath);
      console.log('GEMINI_API_KEY is set:', !!process.env.GEMINI_API_KEY);
      envLoaded = true;
      break;
    }
  } catch (e) {
    console.log('Error loading .env from', envPath, ':', e.message);
  }
}
// test
if (!envLoaded) {
  console.error('Failed to load .env file from any location');
}

// Log all environment variables (excluding sensitive ones)
console.log('Environment variables:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '***set***' : '***not set***',
  SUPABASE_URL: process.env.SUPABASE_URL ? '***set***' : '***not set***'
});

// Validate required environment variables
if (!process.env.GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not configured; authenticated FL APIs remain available while copilot generation is disabled');
}

// Create uploads directory
createUploadsDir();

const app = express();

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000', // Development (removed trailing slash)
  'http://localhost:8080', // Localhost
  'https://lunnaa.vercel.app' //Lunna
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    const isDevelopment = process.env.NODE_ENV !== 'production';
    const isLocalhost =
      origin.includes('localhost') || origin.includes('127.0.0.1');

    if (allowedOrigins.includes(origin) || (isDevelopment && isLocalhost)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS not allowed for origin: ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // handles form-encoded bodies from MacroDroid

// Routes
app.use("/api/gemini", geminiRouter);
app.use("/api/users", userRouter);
app.use("/api/speech", speechRouter);
app.use("/api", uploadRouter); // exposes POST /api/upload
app.use("/api/chat", chatRouter); // Chat endpoints
app.use("/api/feedback", feedbackRouter);
app.use("/api/proxy", proxyRouter);
app.use("/api/fl", flRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "chatbot-backend", phase: "foundation-hardening", capabilities: {
    fl_gateway: true,
    risk_copilot: Boolean(process.env.GEMINI_API_KEY),
    conversation_store: "application_api",
  } });
});
app.get("/", (req, res) => {
  res.send("✅ API service is running");
});

export default app;
