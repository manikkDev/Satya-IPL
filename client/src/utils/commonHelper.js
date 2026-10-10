// Backend URLs (used by Next.js API routes when proxying; server-side only)
// Legacy names maintained for backward compatibility
export const SERVER_URL = process.env.NEXT_PUBLIC_GRAPH_API_URL || "http://localhost:5002";
export const SERVER_URL_1 = process.env.MAIN_API_URL || process.env.NEXT_PUBLIC_MAIN_API_URL || "http://localhost:5001";

// Clear endpoint names for new development
export const GRAPH_API_BASE = SERVER_URL; // Legacy server for Neo4j graph APIs
export const MAIN_API_BASE = SERVER_URL_1; // Main backend
export const ML_API_BASE = process.env.ML_API_URL || "http://localhost:8000"; // Python ML server