// promptLoader.js — versioned prompt files in copilot/prompts/*.md, loaded
// once at first use. Missing files fall back to inline minimal prompts so a
// deploy never fails on a prompt read.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const cache = new Map();

const INLINE_DEFAULTS = {
  "system.v1": "You are Satya, an evidence-led finance assistant. Numbers only as {{F#}} placeholders; citations as [E#]; never claim performed actions; no tax/legal advice; say what evidence is missing instead of guessing. Return JSON.",
  "write.v1": "Answer the question.\nQUESTION: <record>{{QUESTION}}</record>\nINTENT: {{INTENT}}\nCURRENT_CONTEXT:\n{{CONTEXT}}\n{{VIOLATIONS}}",
  "understand.v1": "Classify intent and extract entities as JSON.",
  "draft_message.v1": "Draft a polite supplier clarification email. It is a draft for the user to copy — never sent.",
};

export function prompt(name) {
  if (!cache.has(name)) {
    let text = INLINE_DEFAULTS[name] || "";
    try {
      text = readFileSync(join(dir, "prompts", `${name}.md`), "utf8");
      // strip the <!-- header --> block
      text = text.replace(/^<!--[\s\S]*?-->\s*/, "");
    } catch {
      /* inline default */
    }
    cache.set(name, text);
  }
  return cache.get(name);
}

export const fill = (template, vars) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k) => vars[k] ?? "");
