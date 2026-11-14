// Bank statement import: read (CSV / XLSX / MT940) -> resolve counterparty
// -> dedupe (UTR, else line fingerprint) -> write payment documents.
// Debits become PAYMENT_OUT, credits PAYMENT_IN (receipts are kept for a
// complete statement but AP checks only use PAYMENT_OUT).
import Document from "../../models/Document.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { accountHash } from "../bankAccounts.js";
import { parseCsv } from "./csv.js";
import { parseXlsx } from "./xlsx.js";
import { detectBankLayout, layoutFromMapping, readBankRows, parseMt940, looksLikeMt940, lineFingerprint } from "./bank.js";
import { normName } from "./normalize.js";

export const readStatement = (buffer, fileName = "", { mapping } = {}) => {
  const lower = fileName.toLowerCase();
  const head = buffer.subarray(0, 4000).toString("utf8");
  if (/\.(sta|mt940|940)$/.test(lower) || looksLikeMt940(head)) {
    const { statements, issues } = parseMt940(buffer);
    const lines = statements.flatMap((s) => s.lines.map((l) => ({ ...l, account: s.account })));
    return { format: "mt940", bank: "MT940", account: statements[0]?.account || null, lines, issues, detected: { statements: statements.length, opening: statements[0]?.opening || null, closing: statements.at(-1)?.closing || null } };
  }
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const { rows } = isXlsx ? parseXlsx(buffer) : parseCsv(buffer);
  const layout = (mapping && layoutFromMapping(rows, mapping)) || detectBankLayout(rows);
  if (!layout) {
    const err = new Error("Could not find the statement's column headings (date, narration, withdrawal/deposit or amount). Map the columns manually.");
    throw Object.assign(err, { status: 422, code: "VALIDATION_FAILED", details: { headers: rows.slice(0, 12) } });
  }
  const { lines, issues } = readBankRows(rows, layout);
  const account = (rows.slice(0, layout.headerIndex).flat().join(" ").match(/\b(\d{9,18})\b/) || [])[1] || null;
  return {
    format: isXlsx ? "xlsx" : "csv", bank: layout.bank, account, lines, issues,
    detected: { bank: layout.bank, confidence: layout.confidence, headerRow: layout.headerIndex + 1, columns: Object.fromEntries(Object.entries(layout.columns).map(([role, idx]) => [role, layout.headers[idx]])), headers: layout.headers },
  };
};

const tokens = (s) => normName(s).split(" ").filter((t) => t.length >= 3 && !["and", "pvt", "ltd", "the", "industries", "enterprises", "traders"].includes(t));

/** Resolve a statement line's counterparty to a supplier (name tokens, or a hashed account number in the narration). */
export const resolveCounterparty = (ctx, line) => {
  const text = ` ${normName(line.narration)} `;
  const acctMatches = String(line.narration || "").match(/\b\d{9,18}\b/g) || [];
  if (acctMatches.length && line.ifsc) {
    for (const s of ctx.suppliers) {
      const hashes = new Set((s.bankAccounts || []).map((b) => b.accountHash));
      if (acctMatches.some((a) => hashes.has(accountHash(a, line.ifsc)))) return { supplier: s, by: "bank_account" };
    }
  }
  let best = null; let second = 0;
  for (const s of ctx.suppliers) {
    for (const name of [s.legalName, ...(s.tradeNames || [])]) {
      const t = tokens(name);
      if (!t.length) continue;
      const hit = t.filter((x) => text.includes(` ${x} `) || text.includes(` ${x.slice(0, 6)}`)).length;
      const score = hit / t.length;
      if (hit >= Math.min(2, t.length) && score >= 0.6) {
        if (!best || score > best.score) { second = best?.score || second; best = { supplier: s, score }; }
        else if (score > second && best.supplier.id !== s.id) second = score;
      }
    }
  }
  if (best && best.score > second) return { supplier: best.supplier, by: "name", score: Number(best.score.toFixed(2)) };
  return { supplier: null };
};

const dedupeKey = (l, account) => (l.utr ? `utr:${l.utr}` : `bank:${lineFingerprint(l, account || "")}`);

/** Classify statement lines: new / duplicate, with counterparty resolution. */
export const planBank = async (ctx, statement, { direction = "both" } = {}) => {
  const lines = statement.lines.filter((l) => direction === "both" || (direction === "debits" ? l.direction === "debit" : l.direction === "credit"));
  const utrs = [...new Set(lines.map((l) => l.utr).filter(Boolean))];
  const refs = lines.filter((l) => !l.utr).map((l) => `bank:${lineFingerprint(l, statement.account || "")}`);
  const [byUtr, byRef] = await Promise.all([
    utrs.length ? Document.find({ groupId: ctx.groupId, "payment.utr": { $in: utrs } }, { id: 1, "payment.utr": 1 }).lean() : [],
    refs.length ? Document.find({ groupId: ctx.groupId, externalRef: { $in: refs } }, { id: 1, externalRef: 1 }).lean() : [],
  ]);
  const existing = new Map([...byUtr.map((d) => [`utr:${d.payment.utr}`, d.id]), ...byRef.map((d) => [d.externalRef, d.id])]);
  const seen = new Set();
  const rows = [];
  for (const l of lines) {
    const key = dedupeKey(l, statement.account);
    const cp = l.direction === "debit" ? resolveCounterparty(ctx, l) : { supplier: null };
    let action = "create";
    let existingId = null;
    if (existing.has(key)) { action = "duplicate"; existingId = existing.get(key); }
    else if (seen.has(key)) action = "duplicate";
    seen.add(key);
    rows.push({ ...l, key, action, existingId, supplierId: cp.supplier?.id || null, supplierName: cp.supplier?.legalName || null, matchedBy: cp.by || null });
  }
  return rows;
};

/** Write planned 'create' rows as payment documents. */
export const commitBank = async (ctx, statement, rows) => {
  const created = [];
  for (const r of rows) {
    if (r.action !== "create") continue;
    const supplier = r.supplierId ? ctx.suppliers.find((s) => s.id === r.supplierId) : null;
    const type = r.direction === "debit" ? "PAYMENT_OUT" : "PAYMENT_IN";
    const counterparty = supplier
      ? { name: supplier.legalName, supplierId: supplier.id, ...(supplier.gstins?.[0]?.gstin ? { gstin: supplier.gstins[0].gstin } : {}) }
      : { name: (r.counterparty || "Counterparty").slice(0, 200) };
    try {
      const doc = await Document.create({
        id: newId("doc"), groupId: ctx.groupId, entityId: ctx.entityId, type,
        number: r.utr || r.ref || null,
        externalRef: r.utr ? `bank:utr:${r.utr}` : r.key, date: r.date, fy: fyOf(r.date), status: "posted", revision: 0,
        seller: type === "PAYMENT_OUT" ? counterparty : ctx.buyer,
        buyer: type === "PAYMENT_OUT" ? ctx.buyer : counterparty,
        ...(supplier ? { supplierId: supplier.id } : {}),
        currency: "INR", lines: [],
        payment: { amount: r.amount, mode: r.mode, valueDate: r.valueDate || r.date, ...(r.utr ? { utr: r.utr } : {}), ...(statement.account ? { bankAccountMasked: `****${String(statement.account).replace(/\D/g, "").slice(-4)}` } : {}), allocations: [] },
        source: {
          channel: "bank_csv", sourceSystem: `bank:${statement.bank || "statement"}`, format: statement.format,
          narration: String(r.narration || "").slice(0, 300), bankRef: r.ref || null, balance: r.balance, line: r.line,
          ...(ctx.importRunId ? { importRunId: ctx.importRunId } : {}),
          counterpartyMatch: r.matchedBy || null,
        },
        provenance: "SYSTEM_GENERATED", observedAt: new Date().toISOString(), createdBy: ctx.actor,
      });
      created.push(doc.toObject());
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  return created;
};
