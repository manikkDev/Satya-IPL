import { createReadStream, existsSync, readdirSync } from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import readline from "node:readline";
import HsnMaster from "../../models/HsnMaster.js";

// Seeds the global hsn_master collection from the engine's artifact
// (ml-fl-service/satya_engine/india/hsn_master.py HsnArtifact:
// {version, builtAt, sources, codes[], rateRules[]}). Looks for
// hsn_master.json(.gz) or hsn_master.<ver>.json(.gz). Search order: env
// HSN_MASTER_PATH (dir), server/assets (shipped inside the API image — the
// engine's dir is outside the Docker build context), then the engine's
// assets dir for local dev. The old pattern required a ".<ver>." segment, so
// the committed hsn_master.json.gz was never found and nothing was seeded.
// Safe to re-run: upserts by code; reseeds when the artifact version changes.
const serverRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const searchDirs = () =>
  [process.env.HSN_MASTER_PATH, path.join(serverRoot, "assets"), path.resolve(process.cwd(), "assets"), path.resolve(serverRoot, "../ml-fl-service/assets")].filter(Boolean);

export const findArtifact = () => {
  for (const dir of searchDirs()) {
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).sort().find((name) => /^hsn_master(\.[\w-]+)?\.json(\.gz)?$/.test(name));
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
          // always overwrite: a repaired artifact can move a rule to a
          // longer prefix, and stale rates must not survive the reseed
          rates: rulesByPrefix.get(code.code) || [],
        },
      },
      upsert: true,
    },
  }));
  // rules whose prefix is not itself a directory code still govern longer
  // codes (engine semantics) — keep them on a rule-only holder doc
  const codeSet = new Set((artifact.codes || []).map((c) => c.code));
  for (const [prefix, rates] of rulesByPrefix) {
    if (codeSet.has(prefix)) continue;
    ops.push({ updateOne: { filter: { code: prefix }, update: { $set: { description: `Rate rule ${prefix}`, chapter: prefix.slice(0, 2), artifactVersion: artifact.version, rates, ruleOnly: true } }, upsert: true } });
  }
  let seeded = 0;
  let updated = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await HsnMaster.bulkWrite(ops.slice(i, i + 500));
    seeded += r.upsertedCount;
    updated += r.modifiedCount;
  }
  return { seeded: seeded + updated, inserted: seeded, updated, total: ops.length, version: artifact.version, file };
};
