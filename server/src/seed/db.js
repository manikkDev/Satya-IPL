// Shared Mongo connection for the seed CLIs. Same resolution as the server
// (config/db.js): DB_URI | MONGO_URI with an explicit dbName, so Atlas URIs
// never fall through to the driver's default "test" database.
import "dotenv/config";
import mongoose from "mongoose";
import { DEMO_COMPANY_ID } from "./company.js";

export const connect = async () => {
  // Inside the running server: reuse its connection and never close it.
  if (mongoose.connection.readyState === 1) {
    return { db: mongoose.connection.db, dbName: mongoose.connection.name, close: async () => {} };
  }
  const uri = process.env.DB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set DB_URI or MONGO_URI");
  const dbName = process.env.APP_DB_NAME || "satya";
  await mongoose.connect(uri, { dbName });
  return { db: mongoose.connection.db, dbName, close: () => mongoose.disconnect() };
};

export const findDemoGroup = (db) => db.collection("groups").findOne({ legacyCompanyId: DEMO_COMPANY_ID });
