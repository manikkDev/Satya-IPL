import { createReadStream, existsSync, readdirSync } from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import readline from "node:readline";
import HsnMaster from "../../models/HsnMaster.js";

// Seeds the global hsn_master collection from the engine's artifact
// (ml-fl-service/satya_engine/india/hsn_master.py HsnArtifact:
// {version, builtAt, sources, codes[], rateRules[]}). Looks for
// assets/hsn_master.*.json or .json.gz (env HSN_MASTER_PATH overrides the dir).
// Safe to re-run: upserts by code; skips entirely when no artifact exists yet.
const searchDirs = () =>
  [process.env.HSN_MASTER_PATH, path.resolve(process.cwd(), "../ml-fl-service/assets"), path.resolve(process.cwd(), "assets")].filter(Boolean);

const findArtifact = () => {
  for (const dir of searchDirs()) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((name) => /^hsn_master\..*\.json(\.gz)?$/.test(name));
    if (file) return path.join(dir, file);
  }
  return null;
};

const readJson = async (file) => {
  const stream = createReadStream(file);
  const source = file.endsWith(".gz") ? stream.pipe(zlib.createGunzip()) : stream;
  const chunks = [];
  for await (const chunk of source) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export const seedHsnMaster = async ({ force = false } = {}) => {
  const file = findArtifact();
  if (!file) return { seeded: 0, skipped: "no hsn_master artifact found yet" };
  const artifact = await readJson(file);
  const existing = force ? 0 : await HsnMaster.estimatedDocumentCount();
  if (existing && (await HsnMaster.exists({ artifactVersion: artifact.version }))) {
    return { seeded: 0, skipped: `version ${artifact.version} already seeded` };
  }
  // attach each rate rule to the doc whose code equals its prefix
  const rulesByPrefix = new Map();
  for (const rule of artifact.rateRules || []) {
    if (!rulesByPrefix.has(rule.prefix)) rulesByPrefix.set(rule.prefix, []);
    rulesByPrefix.get(rule.prefix).push({
      prefix: rule.prefix,
      rate: rule.rate,
      cessRate: rule.cessRate ?? undefined,
      schedule: rule.schedule,
      sNo: rule.sNo,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo ?? undefined,
      notificationRef: rule.notificationRef,
      conditional: Boolean(rule.conditional),
    });
  }
  const ops = (artifact.codes || []).map((code) => ({
    updateOne: {
      filter: { code: code.code },
      update: {
        $set: {
          description: code.description,
          chapter: code.chapter,
          artifactVersion: artifact.version,
          ...(rulesByPrefix.has(code.code) ? { rates: rulesByPrefix.get(code.code) } : {}),
        },
      },
      upsert: true,
    },
  }));
  let seeded = 0;
  for (let i = 0; i < ops.length; i += 500) {
    seeded += (await HsnMaster.bulkWrite(ops.slice(i, i + 500))).upsertedCount;
  }
  return { seeded, total: ops.length, version: artifact.version, file };
};
