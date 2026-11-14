import mongoose from "mongoose";

// Mongo connection. Accepts MONGO_URI or DB_URI and always pins dbName
// (APP_DB_NAME, default "satya") — an Atlas URI without a path would
// otherwise write everything into the "test" database.
export const mongoUri = () => (process.env.MONGO_URI || "").trim() || (process.env.DB_URI || "").trim();
export const dbName = () => (process.env.APP_DB_NAME || "").trim() || "satya";

const redact = (uri) => uri.replace(/\/\/([^@/]+)@/, "//***@");

/**
 * Connects, retrying a few times. Throws with a clear message when no URI is
 * configured or every attempt fails — the caller keeps the HTTP server up so
 * /api/health shows the service is alive but has no database.
 */
const connectDB = async ({ retries = 5, delayMs = 3000 } = {}) => {
  const uri = mongoUri();
  if (!uri) {
    const error = new Error("No MongoDB connection string: set MONGO_URI or DB_URI");
    console.error(`[db] FATAL CONFIG: ${error.message}. /api/health still answers, every data route returns 503 until this is set.`);
    throw error;
  }
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(uri, { dbName: dbName(), serverSelectionTimeoutMS: 10000 });
      console.log(`[db] MongoDB connected: ${conn.connection.host} db=${conn.connection.name}`);
      return conn;
    } catch (error) {
      lastError = error;
      console.error(`[db] connection attempt ${attempt}/${retries} to ${redact(uri)} failed: ${error.message}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastError;
};

export default connectDB;
