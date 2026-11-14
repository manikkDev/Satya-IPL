// Small, dependency-free CSV reader for customer exports.
//
// Handles what Indian bank / ERP exports actually contain: a UTF-8 BOM,
// quoted fields with embedded commas, newlines and doubled quotes, CRLF line
// endings, and comma / semicolon / tab / pipe delimiters (detected from the
// first lines). Returns rows as arrays of trimmed strings; callers pick the
// header row themselves because bank exports put account details first.

const DELIMS = [",", ";", "\t", "|"];

/** Pick the delimiter that splits the first non-empty lines most consistently. */
export const detectDelimiter = (text) => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  let best = ",";
  let bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const multi = counts.filter((c) => c > 1);
    if (!multi.length) continue;
    // reward many columns appearing on many lines with the same width
    const mode = [...multi].sort((a, b) => multi.filter((x) => x === b).length - multi.filter((x) => x === a).length)[0];
    const score = multi.filter((c) => c === mode).length * Math.min(mode, 12);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
};

// quote-aware split of a single physical line (delimiter detection only)
const splitLine = (line, d) => {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === d && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
};

/** Parse CSV text into string[][] (all rows, header included). */
export const parseCsv = (input, { delimiter, maxRows = 50000 } = {}) => {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const pushField = () => { row.push(field.trim()); field = ""; };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === "") { field = ""; quoted = true; i++; continue; }
    if (c === d) { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") {
      pushRow(); i++;
      if (rows.length >= maxRows) break;
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length) pushRow();
  return { rows, delimiter: d };
};

/** Normalise a header cell for matching: lower-case, punctuation folded. */
export const normHeader = (h) => String(h ?? "")
  .toLowerCase()
  .replace(/\(inr\s*\)|\(₹\)|\(rs\.?\)|\binr\b|₹/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/** Rows -> objects keyed by the header row (index `headerIndex`). */
export const rowsToObjects = (rows, headerIndex = 0) => {
  const header = (rows[headerIndex] || []).map((h, i) => (h ? String(h).trim() : `column_${i + 1}`));
  return rows.slice(headerIndex + 1).map((r, n) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ""; });
    Object.defineProperty(obj, "__row", { value: headerIndex + n + 2, enumerable: false }); // 1-based file line
    return obj;
  });
};

/** Quote one CSV cell. */
export const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
