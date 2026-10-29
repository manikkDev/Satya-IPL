// validate.js — grounding validator between the writer and the user (stage 7).
// Rejects: ungrounded digit sequences, unknown {{F#}}/[E#] refs, claims of
// performed actions, certainty stronger than the weakest supporting fact.
// On reject the pipeline retries once with the violations listed, then falls
// back to a deterministic template (responseMode:"evidence_only").

const FACT_RE = /\{\{F(\d+)\}\}/g;
const CITE_RE = /\[E(\d+)\]/g;
const CERTAINTY_ORDER = ["CONFIRMED", "PROBABLE", "POSSIBLE", "AMBIGUOUS", "INSUFFICIENT_EVIDENCE"];

const ACTION_CLAIM =
  /\b(?:i|we|satya)\s+(?:have\s+|has\s+|just\s+|already\s+)?(?:approved|paid|sent|emailed|mailed|released|updated|deleted|linked|held|blocked|rejected|reconciled|uploaded|confirmed|issued|created|filed|escalated|allocated|adjusted)\b/i;
const ACTION_PASSIVE =
  /\b(?:has|have)\s+been\s+(?:approved|paid|sent|released|linked|held|blocked|rejected|reconciled|deleted|issued|created|filed|allocated)\s+(?:by me|by satya|by us|automatically)\b/i;

/**
 * @param {object} draft {answerMarkdown, certainty, followUps, cards?}
 * @param {FactRegistry} registry facts + evidence gathered by tools
 * @param {object} context {identifiers: string[]} verbatim strings the
 *   writer may reference (document numbers, ids, dates, names from tools)
 * @returns {{ok:true}|{ok:false, violations:string[]}}
 */
export function validateAnswer(draft, registry, context = {}) {
  const violations = [];
  const text = typeof draft?.answerMarkdown === "string" ? draft.answerMarkdown : "";
  if (!text || text.length > 6000) violations.push("answer is empty or exceeds 6000 characters");

  // Every {{F#}} and [E#] must resolve to a registered fact/evidence.
  for (const m of text.matchAll(FACT_RE)) {
    if (!registry.hasFact(`F${m[1]}`)) violations.push(`unknown fact placeholder {{F${m[1]}}}`);
  }
  for (const m of text.matchAll(CITE_RE)) {
    if (!registry.hasEvidence(`E${m[1]}`)) violations.push(`unknown citation [E${m[1]}]`);
  }

  // Strip placeholders + citations, then every remaining digit run must be a
  // verbatim part of an allowed identifier/date (or a list marker / year).
  const stripped = text.replace(FACT_RE, " ").replace(CITE_RE, " ");
  const allowed = buildAllowedDigitRuns(context.identifiers || []);
  for (const m of stripped.matchAll(/\d+/g)) {
    const run = m[0];
    if (allowed.has(run)) continue;
    const before = stripped[m.index - 1];
    const after = stripped[m.index + run.length];
    if (/^\s/.test(before) && /^[.)]/.test(after) && run.length <= 2) continue; // "1." list marker
    if (/^\d{4}$/.test(run)) {
      const n = Number(run);
      if (n >= 1990 && n <= 2100) continue; // bare year
    }
    violations.push(`ungrounded number "${run}" — numbers must come from facts ({{F#}})`);
  }

  if (ACTION_CLAIM.test(stripped) || ACTION_PASSIVE.test(stripped)) {
    violations.push("claims an action was performed — Satya never approves, pays, sends or modifies records");
  }

  if (draft?.certainty && !CERTAINTY_ORDER.includes(draft.certainty)) {
    violations.push(`invalid certainty "${draft.certainty}"`);
  }
  const weakest = registry.weakestCertainty();
  if (
    draft?.certainty &&
    CERTAINTY_ORDER.includes(draft.certainty) &&
    CERTAINTY_ORDER.indexOf(draft.certainty) < CERTAINTY_ORDER.indexOf(weakest)
  ) {
    violations.push(`certainty ${draft.certainty} is stronger than the weakest supporting fact (${weakest})`);
  }

  if (draft?.followUps && (!Array.isArray(draft.followUps) || draft.followUps.length > 3)) {
    violations.push("followUps must be an array of at most 3 strings");
  }

  return violations.length ? { ok: false, violations } : { ok: true };
}

/** All digit runs appearing inside allowed context strings are legitimate. */
function buildAllowedDigitRuns(identifiers) {
  const runs = new Set();
  for (const id of identifiers) {
    for (const m of String(id).matchAll(/\d+/g)) runs.add(m[0]);
    for (const m of String(id).matchAll(/\d{4}-\d{2}-\d{2}/g)) {
      for (const p of m[0].split("-")) runs.add(p);
    }
  }
  return runs;
}

/** Collect identifier-ish strings out of tool results for the context. */
export function collectIdentifiers(values) {
  const out = new Set();
  const walk = (v, depth) => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") {
      if (/\d/.test(v) && v.length <= 80) out.add(v);
      for (const m of v.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) out.add(m[0]);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === "object") Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(values, 0);
  return [...out];
}
