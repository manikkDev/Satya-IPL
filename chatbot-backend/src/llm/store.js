// store.js — optional Mongo persistence for the AI-owned collections:
//   ai_key_state   (keyHash → serialized pool state; the raw key is never stored)
//   ai_usage_daily (dayKey+model+task counters)
// Falls back silently to in-memory when DB_URI is absent so the gateway
// always boots (graceful degradation, 00 §4.10).

import { MongoClient } from "mongodb";
import { InMemoryStore } from "./keyPool.js";

const CONNECT_TIMEOUT_MS = 10_000;

export async function connectMongo(uri, dbName) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  return client.db(dbName);
}

export class MongoKeyStateStore {
  constructor(db) {
    this.col = db.collection("ai_key_state");
    this.ready = this.col.createIndex({ keyHash: 1 }, { unique: true }).catch(() => {});
  }
  async load() {
    await this.ready;
    const docs = await this.col.find({}).toArray();
    return new Map(docs.map((d) => [d.keyHash, d]));
  }
  async save(keyHash, doc) {
    await this.ready;
    await this.col.updateOne({ keyHash }, { $set: doc }, { upsert: true });
  }
  async close() {}
}

export class MongoUsageDailyStore {
  constructor(db) {
    this.col = db.collection("ai_usage_daily");
    this.ready = this.col
      .createIndex({ dayKey: 1, model: 1, task: 1 }, { unique: true })
      .catch(() => {});
  }
  async record(dayKey, model, task, inc) {
    await this.ready;
    await this.col.updateOne(
      { dayKey, model, task },
      {
        $inc: {
          requests: inc.requests || 0,
          inputTokens: inc.inputTokens || 0,
          outputTokens: inc.outputTokens || 0,
          failures: inc.failures || 0,
          fallbacks: inc.fallbacks || 0,
        },
        $setOnInsert: { dayKey, model, task },
      },
      { upsert: true },
    );
  }
}

/**
 * Build the persistence bundle. Returns {keyStateStore, dailyStore, mongo, db}
 * where mongo/db are null when no DB is configured or reachable.
 */
export async function createStores({ dbUri, dbName }) {
  if (!dbUri) {
    return { keyStateStore: new InMemoryStore(), dailyStore: null, mongo: null, db: null };
  }
  try {
    const mongo = new MongoClient(dbUri, {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
      connectTimeoutMS: CONNECT_TIMEOUT_MS,
    });
    await mongo.connect();
    const db = mongo.db(dbName);
    return {
      keyStateStore: new MongoKeyStateStore(db),
      dailyStore: new MongoUsageDailyStore(db),
      mongo,
      db,
    };
  } catch (error) {
    console.warn(`[llm] Mongo unavailable (${error.message}) — key state is memory-only`);
    return { keyStateStore: new InMemoryStore(), dailyStore: null, mongo: null, db: null };
  }
}
