// Bank statement readers: column auto-detection for the CSV/XLSX exports of
// common Indian banks, an MT940 parser, and narration parsing (UTR, payment
// mode, IFSC, invoice references, counterparty name).
//
// Header layouts observed on bank exports (indicative — banks vary them by
// product and channel, so detection is synonym-based with a confidence
// score, and a user mapping always wins):
//   HDFC   Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
//   ICICI  S No. | Value Date | Transaction Date | Cheque Number | Transaction Remarks |
//          Withdrawal Amount (INR ) | Deposit Amount (INR ) | Balance (INR )
//   SBI    Txn Date | Value Date | Description | Ref No./Cheque No. | Branch Code | Debit | Credit | Balance
//   Axis   Tran Date | CHQNO | PARTICULARS | DR | CR | BAL | SOL
//   Kotak  Sl. No. | Transaction Date | Value Date | Description | Chq / Ref No. | Debit | Credit | Balance
//          (some Kotak/ICICI corporate exports: Amount + Dr / Cr indicator column)
import crypto from "node:crypto";
import { normHeader } from "./csv.js";
import { parseDate, parseAmount, normInvNo } from "./normalize.js";

const ROLE_SYNONYMS = {
  date: ["date", "txn date", "transaction date", "tran date", "trans date", "posting date", "post date", "txn posted date", "transaction posted date", "book date"],
  valueDate: ["value dt", "value date", "valuedate"],
  narration: ["narration", "description", "particulars", "transaction remarks", "remarks", "transaction details", "details", "transaction description", "transaction particulars", "narrative"],
  ref: ["chq ref no", "chq ref number", "chq no", "chqno", "cheque no", "cheque number", "ref no cheque no", "ref no", "reference no", "reference number", "chq ref", "cheque ref no", "instrument no", "transaction id", "tran id", "utr", "utr no", "utr number", "ref no chq no", "chq no ref no"],
  debit: ["withdrawal amt", "withdrawal amount", "withdrawal", "withdrawals", "debit", "debit amount", "dr", "withdrawal dr", "debits", "dr amount", "debit amt", "withdrawl amt", "withdrawal amt dr"],
  credit: ["deposit amt", "deposit amount", "deposit", "deposits", "credit", "credit amount", "cr", "deposit cr", "credits", "cr amount", "credit amt", "deposit amt cr"],
  amount: ["amount", "transaction amount", "txn amount", "tran amount"],
  drcr: ["cr dr", "dr cr", "dr cr indicator", "cr dr indicator", "debit credit", "type", "txn type", "transaction type", "d c"],
  balance: ["closing balance", "balance", "available balance", "running balance", "bal", "closing bal", "balance amt"],
};

const roleOf = (header) => {
  const h = normHeader(header);
  if (!h) return null;
  for (const [role, names] of Object.entries(ROLE_SYNONYMS)) if (names.includes(h)) return role;
  // looser prefix matches for decorated headers ("Withdrawal Amount (INR )")
  for (const [role, names] of Object.entries(ROLE_SYNONYMS)) {
    if (names.some((n) => n.length > 3 && (h.startsWith(`${n} `) || h === n))) return role;
  }
  return null;
};

const PROFILES = [
  { bank: "HDFC", test: (hs) => hs.has("narration") && (hs.has("chq ref no") || hs.has("value dt")) && hs.has("withdrawal amt") },
  { bank: "ICICI", test: (hs) => hs.has("transaction remarks") || (hs.has("withdrawal amount") && hs.has("deposit amount")) },
  { bank: "SBI", test: (hs) => hs.has("txn date") && (hs.has("ref no cheque no") || hs.has("branch code")) },
  { bank: "Axis", test: (hs) => hs.has("tran date") && (hs.has("chqno") || hs.has("chq no")) && hs.has("particulars") },
  { bank: "Kotak", test: (hs) => (hs.has("chq ref no") || hs.has("chq ref number")) && (hs.has("withdrawal dr") || hs.has("deposit cr") || hs.has("dr cr") || hs.has("debit")) },
];

/**
 * Find the header row in the first rows of a sheet and map columns to roles.
 * Returns {headerIndex, columns: {role: index}, headers, bank, confidence} or null.
 */
export const detectBankLayout = (rows) => {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i] || [];
    const columns = {};
    cells.forEach((c, idx) => {
      const role = roleOf(c);
      if (role && columns[role] === undefined) columns[role] = idx;
    });
    if (columns.date === undefined && columns.valueDate !== undefined) { columns.date = columns.valueDate; }
    const hasMoney = (columns.debit !== undefined && columns.credit !== undefined) || columns.amount !== undefined;
    if (columns.date === undefined || !hasMoney) continue;
    const score = Object.keys(columns).length + (columns.narration !== undefined ? 2 : 0);
    if (!best || score > best.score) best = { headerIndex: i, columns, score };
  }
  if (!best) return null;
  const headers = rows[best.headerIndex];
  const hs = new Set(headers.map(normHeader));
  const profile = PROFILES.find((p) => p.test(hs));
  const confidence = Math.min(1, best.score / 7);
  return { headerIndex: best.headerIndex, columns: best.columns, headers, bank: profile?.bank || "generic", confidence: Number(confidence.toFixed(2)) };
};

/** Explicit mapping {role: headerName} -> column indexes against a header row. */
export const layoutFromMapping = (rows, mapping) => {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const headers = rows[i] || [];
    const idx = (name) => (name ? headers.findIndex((h) => String(h).trim().toLowerCase() === String(name).trim().toLowerCase()) : -1);
    const columns = {};
    for (const [role, name] of Object.entries(mapping || {})) {
      const k = idx(name);
      if (k >= 0) columns[role] = k;
    }
    if (columns.date !== undefined && (columns.amount !== undefined || (columns.debit !== undefined && columns.credit !== undefined))) {
      return { headerIndex: i, columns, headers, bank: "mapped", confidence: 1 };
    }
  }
  return null;
};

// --- narration parsing ---------------------------------------------------
const UTR_PATTERNS = [
  /\b([A-Z]{4}R[0-9A-Z]\d{16})\b/, // RTGS: 22 chars
  /\b([A-Z]{4}[0-9A-Z]?N\d{9,12})\b/, // NEFT: e.g. HDFCN26306733217
  /\b([A-Z]{4}H\d{9,12})\b/, // NEFT (H series)
];
const IFSC = /\b([A-Z]{4}0[A-Z0-9]{6})\b/;

export const modeOf = (narration) => {
  const n = String(narration || "").toUpperCase();
  if (/\bRTGS\b/.test(n)) return "RTGS";
  if (/\bNEFT\b/.test(n)) return "NEFT";
  if (/\bIMPS\b|\bMMT\b/.test(n)) return "IMPS";
  if (/\bUPI\b/.test(n)) return "UPI";
  if (/\bCHQ\b|\bCHEQUE\b|\bCLG\b|\bCLEARING\b|\bCTS\b/.test(n)) return "CHEQUE";
  return "OTHER";
};

export const utrOf = (narration, ref) => {
  const n = String(narration || "").toUpperCase();
  for (const p of UTR_PATTERNS) { const m = p.exec(n); if (m) return m[1]; }
  const r = String(ref || "").toUpperCase().replace(/\s/g, "");
  if (/^[A-Z0-9]{12,22}$/.test(r) && !/^0+$/.test(r) && /\d{6}/.test(r)) return r;
  if (/\b(IMPS|UPI|MMT)\b/.test(n)) { const m = /\b(\d{12})\b/.exec(n); if (m) return m[1]; }
  return null;
};

const NOISE = /\b(NEFT|RTGS|IMPS|UPI|MMT|DR|CR|TO|BY|TRF|TRANSFER|INB|NETBANK|MOB|MUM|CHQ|PAID|PAYMENT|ONLINE|FT|IB|INF|TXT|NA)\b/g;
/** Best-effort counterparty text from a narration ("NEFT DR-SBIN..-SHAKTI INDUSTRIAL-..." -> "SHAKTI INDUSTRIAL"). */
export const counterpartyOf = (narration) => {
  const parts = String(narration || "").toUpperCase().split(/[-/|:]+/).map((p) => p.replace(IFSC, " ").replace(NOISE, " ").replace(/[^A-Z&. ]+/g, " ").replace(/\s+/g, " ").trim());
  const candidates = parts.filter((p) => p.replace(/[^A-Z]/g, "").length >= 4);
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
};

/** Normalised narration haystack for invoice-number search. */
export const narrationKey = (narration) => normInvNo(narration);

/** Line fingerprint for dedupe when the bank gives no UTR. */
export const lineFingerprint = (l, account = "") => crypto.createHash("sha1")
  .update([account, l.date, l.direction, l.amount, String(l.narration || "").replace(/\s+/g, " ").trim().toUpperCase(), l.balance || ""].join("|"))
  .digest("hex").slice(0, 20);

const finishLine = (base) => {
  const utr = utrOf(base.narration, base.ref);
  return {
    ...base,
    utr,
    mode: modeOf(base.narration),
    ifsc: IFSC.exec(String(base.narration || "").toUpperCase())?.[1] || null,
    counterparty: counterpartyOf(base.narration),
  };
};

/**
 * Sheet rows -> normalised statement lines using a detected or mapped layout.
 * Each line: {line, date, valueDate, narration, ref, amount, direction, balance, utr, mode, ifsc, counterparty}
 * plus issues[] for rows that could not be read.
 */
export const readBankRows = (rows, layout) => {
  const { columns, headerIndex } = layout;
  const lines = [];
  const issues = [];
  const cell = (r, role) => (columns[role] === undefined ? "" : String(r[columns[role]] ?? "").trim());
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const fileLine = i + 1;
    const rawDate = cell(r, "date");
    // footer lines ("Opening balance", "*** End of statement") have no date
    if (!rawDate || /^(\*|opening|closing|total|statement|page|generated)/i.test(rawDate)) continue;
    // summary/footer rows carry balances or counts in the date column — only
    // something shaped like a date is a transaction line
    if (!/^\d{1,4}[-/.\s]([A-Za-z]{3,9}|\d{1,2})[-/.\s,]*\d{2,4}|^\d{8}$|^\d{5}(\.\d+)?$/.test(rawDate)) continue;
    const date = parseDate(rawDate);
    if (!date) { issues.push({ line: fileLine, field: "date", severity: "error", message: `Could not read date "${rawDate}"` }); continue; }
    let amount = null;
    let direction = null;
    const dr = parseAmount(cell(r, "debit"));
    const cr = parseAmount(cell(r, "credit"));
    if (dr && Number(dr.value) > 0) { amount = dr.value; direction = "debit"; }
    else if (cr && Number(cr.value) > 0) { amount = cr.value; direction = "credit"; }
    else if (columns.amount !== undefined) {
      const a = parseAmount(cell(r, "amount"));
      const ind = cell(r, "drcr").toUpperCase();
      if (a && Number(a.value) > 0) {
        amount = a.value;
        direction = ind ? (/^(D|DR|DEBIT|W)/.test(ind) ? "debit" : "credit") : a.sign < 0 ? "debit" : "credit";
      }
    }
    if (!amount) { issues.push({ line: fileLine, field: "amount", severity: "error", message: "No withdrawal or deposit amount on this line" }); continue; }
    lines.push(finishLine({
      line: fileLine, date,
      valueDate: parseDate(cell(r, "valueDate")) || date,
      narration: cell(r, "narration"), ref: cell(r, "ref"),
      amount, direction,
      balance: parseAmount(cell(r, "balance"))?.value ?? null,
    }));
  }
  return { lines, issues };
};

// --- MT940 ---------------------------------------------------------------
const mtAmount = (s) => {
  const [i, f = ""] = String(s).split(",");
  return `${Number(i)}.${(f + "00").slice(0, 2)}`;
};
const mtDate = (yymmdd) => {
  const y = Number(yymmdd.slice(0, 2));
  return parseDate(`${2000 + y}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`);
};

export const looksLikeMt940 = (text) => /:20:/.test(text) && /:61:/.test(text) && /:25:/.test(text);

/** Parse MT940 text into {statements:[{reference, account, opening, closing, lines}], issues}. */
export const parseMt940 = (input) => {
  const text = (Buffer.isBuffer(input) ? input.toString("utf8") : String(input)).replace(/\r/g, "");
  // tags start at line beginnings; join continuation lines to their tag
  const fields = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\{\d:[^}]*\}?/, "").replace(/-\}$/, "");
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) fields.push({ tag: m[1], value: m[2] });
    else if (fields.length && line.trim() && line.trim() !== "-") fields[fields.length - 1].value += `\n${line}`;
  }
  const statements = [];
  const issues = [];
  let cur = null;
  let lastLine = null;
  let n = 0;
  for (const f of fields) {
    if (f.tag === "20") { cur = { reference: f.value.trim(), account: null, opening: null, closing: null, lines: [] }; statements.push(cur); lastLine = null; continue; }
    if (!cur) { cur = { reference: null, account: null, opening: null, closing: null, lines: [] }; statements.push(cur); }
    if (f.tag === "25") cur.account = f.value.trim();
    else if (f.tag === "60F" || f.tag === "60M") {
      const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(f.value.trim());
      if (m) cur.opening = { date: mtDate(m[2]), currency: m[3], amount: mtAmount(m[4]), sign: m[1] };
    } else if (f.tag === "62F" || f.tag === "62M") {
      const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(f.value.trim());
      if (m) cur.closing = { date: mtDate(m[2]), currency: m[3], amount: mtAmount(m[4]), sign: m[1] };
    } else if (f.tag === "61") {
      n++;
      const [first, ...rest] = f.value.split("\n");
      const m = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d]+,\d{0,2})([A-Z0-9]{4})?([^/]*?)(?:\/\/(.*))?$/.exec(first.trim());
      if (!m) { issues.push({ line: n, field: ":61:", severity: "error", message: `Unreadable MT940 statement line "${first.slice(0, 40)}"` }); lastLine = null; continue; }
      const mark = m[3];
      const direction = mark === "D" || mark === "RC" ? "debit" : "credit";
      lastLine = {
        line: n, date: mtDate(m[1]), valueDate: mtDate(m[1]),
        amount: mtAmount(m[5]), direction,
        ref: (m[7] || "").trim() === "NONREF" ? "" : (m[7] || "").trim(),
        bankRef: (m[8] || "").trim(), supplementary: rest.join(" ").trim(),
        narration: "", balance: null,
      };
      cur.lines.push(lastLine);
    } else if (f.tag === "86" && lastLine) {
      lastLine.narration = f.value.replace(/\n/g, "").replace(/\?\d{2}/g, " ").replace(/\/(TXT|INF|REMI|NARR)\//g, " ").replace(/\s+/g, " ").trim();
    }
  }
  for (const s of statements) {
    s.lines = s.lines.map((l) => finishLine({ ...l, narration: [l.narration, l.supplementary].filter(Boolean).join(" ").trim() || l.ref, ref: l.ref || l.bankRef }));
  }
  return { statements: statements.filter((s) => s.lines.length || s.opening), issues };
};
