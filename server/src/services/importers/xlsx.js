// Minimal .xlsx reader (no dependency): reads the zip central directory,
// inflates only the parts it needs (workbook, rels, sharedStrings, styles,
// the chosen sheet) and returns string[][] like parseCsv. Dates stored as
// serial numbers in date-formatted cells come back as YYYY-MM-DD.
// Supports the ordinary shapes Excel / LibreOffice / Google Sheets write;
// not zip64, encryption or .xls (BIFF).
import zlib from "node:zlib";
import { parseXml, kids, kid, findAll } from "./xml.js";

const MAX_ENTRY_BYTES = 40 * 1024 * 1024; // inflated part cap (memory guard on small instances)

export const readZip = (buf) => {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw Object.assign(new Error("Not a valid .xlsx file (zip directory missing)"), { status: 422 });
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.set(name, { method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > MAX_ENTRY_BYTES) throw Object.assign(new Error(`Spreadsheet part ${name} is too large to import`), { status: 422 });
    const lh = e.localOffset;
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    throw Object.assign(new Error(`Unsupported zip compression (${e.method})`), { status: 422 });
  };
  return { names: [...entries.keys()], read };
};

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

const colIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export const serialToDate = (serial) => {
  const ms = Math.round((Number(serial) - 25569) * 86400000); // 1900 date system
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(serial) : d.toISOString().slice(0, 10);
};

const richText = (si) => {
  const t = kid(si, "t");
  if (t) return t.text;
  return kids(si, "r").map((r) => kid(r, "t")?.text || "").join("");
};

/** Parse the first (or named) sheet of an .xlsx buffer into string[][]. */
export const parseXlsx = (buf, { sheet, maxRows = 50000 } = {}) => {
  const zip = readZip(buf);
  const wb = parseXml(zip.read("xl/workbook.xml") || Buffer.alloc(0));
  const sheets = findAll(wb, "sheet").map((s) => ({ name: s.attrs.name, rid: s.attrs["r:id"] || s.attrs.id }));
  const rels = parseXml(zip.read("xl/_rels/workbook.xml.rels") || Buffer.alloc(0));
  const target = new Map(findAll(rels, "Relationship").map((r) => [r.attrs.Id, r.attrs.Target]));
  const chosen = (sheet && sheets.find((s) => s.name === sheet)) || sheets[0];
  let path = chosen ? target.get(chosen.rid) : null;
  if (path) path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
  if (!path || !zip.names.includes(path)) path = zip.names.find((n) => /^xl\/worksheets\/sheet\d*\.xml$/.test(n));
  if (!path) throw Object.assign(new Error("The workbook has no worksheet"), { status: 422 });

  const sstXml = zip.read("xl/sharedStrings.xml");
  const shared = sstXml ? kids(kid(parseXml(sstXml), "sst"), "si").map(richText) : [];

  const dateStyles = new Set();
  const stylesXml = zip.read("xl/styles.xml");
  if (stylesXml) {
    const st = kid(parseXml(stylesXml), "styleSheet");
    const custom = new Map(findAll(kid(st, "numFmts"), "numFmt").map((f) => [Number(f.attrs.numFmtId), f.attrs.formatCode || ""]));
    kids(kid(st, "cellXfs"), "xf").forEach((xf, idx) => {
      const id = Number(xf.attrs.numFmtId || 0);
      const code = custom.get(id);
      if (BUILTIN_DATE_FMTS.has(id) || (code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, "")))) dateStyles.add(idx);
    });
  }

  const sheetXml = parseXml(zip.read(path));
  const data = kid(kid(sheetXml, "worksheet"), "sheetData");
  const rows = [];
  for (const r of kids(data, "row")) {
    if (rows.length >= maxRows) break;
    const out = [];
    for (const c of kids(r, "c")) {
      const idx = colIndex(c.attrs.r);
      const col = idx >= 0 ? idx : out.length;
      const t = c.attrs.t;
      const v = kid(c, "v")?.text ?? "";
      let val;
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = richText(kid(c, "is") || { children: [] });
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (t === "str" || t === "e") val = v;
      else if (v !== "" && dateStyles.has(Number(c.attrs.s || 0)) && Number.isFinite(Number(v))) val = serialToDate(v);
      else val = v;
      while (out.length < col) out.push("");
      out[col] = String(val).trim();
    }
    if (out.some((x) => x !== "")) rows.push(out);
  }
  return { rows, sheets: sheets.map((s) => s.name), sheet: chosen?.name || null };
};

// --- writer: a single-sheet .xlsx for downloadable templates -------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

const zipFiles = (files) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, "utf8");
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Build an .xlsx with one sheet; every cell is written as text. Row 1 bold. */
export const buildXlsx = (rows, sheetName = "Sheet1") => {
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("");
  const widths = (rows[0] || []).map((_, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${Math.min(40, Math.max(12, ...rows.map((r) => String(r[ci] ?? "").length + 2)))}" customWidth="1"/>`).join("");
  return zipFiles([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>'],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
};
