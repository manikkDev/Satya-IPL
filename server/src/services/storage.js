import mongoose from "mongoose";
import crypto from "node:crypto";
import FileDoc from "../models/FileDoc.js";
import { newId } from "../lib/ids.js";

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });

export const sha256Of = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

export const putFile = async ({ buffer, filename, mime, groupId, entityId, uploadedBy }) => {
  const sha256 = sha256Of(buffer);
  const existing = await FileDoc.findOne({ sha256, groupId }).lean();
  if (existing) return { file: existing, duplicateOf: existing.id };
  const gridfsId = await new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(filename, { contentType: mime });
    stream.on("error", reject);
    stream.on("finish", () => resolve(stream.id));
    stream.end(buffer);
  });
  const file = await FileDoc.create({
    id: newId("file"), groupId, entityId, filename, mime,
    size: buffer.length, sha256, gridfsId, uploadedBy,
  });
  return { file, duplicateOf: null };
};

export const getFileBuffer = async (file) => {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(file.gridfsId)) chunks.push(chunk);
  return Buffer.concat(chunks);
};

export const streamFile = (file, res) => {
  res.set("content-type", file.mime);
  res.set("content-length", String(file.size));
  bucket().openDownloadStream(file.gridfsId).on("error", () => res.status(404).end()).pipe(res);
};
