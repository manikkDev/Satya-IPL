// Tolerant, dependency-free XML reader (enough for TallyPrime exports and the
// OOXML parts of an .xlsx). Produces a light element tree:
//   { name, attrs: {k: v}, children: [element], text }
// It ignores comments, processing instructions and DOCTYPE, keeps CDATA as
// text, decodes the predefined + numeric entities, and drops the control
// characters Tally writes as &#4; inside names. Not a validating parser:
// unbalanced end tags are tolerated by unwinding to the matching open tag.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === "#") {
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code)) return "";
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return ""; // Tally's &#4; markers
    try { return String.fromCodePoint(code); } catch { return ""; }
  }
  return ENTITIES[e] ?? m;
});

/** Decode a file buffer honouring UTF-16 BOMs (Tally exports UTF-16 LE). */
export const decodeText = (input) => {
  if (!Buffer.isBuffer(input)) return String(input ?? "");
  if (input[0] === 0xff && input[1] === 0xfe) return input.subarray(2).toString("utf16le");
  if (input[0] === 0xfe && input[1] === 0xff) {
    const swapped = Buffer.from(input.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  // UTF-16 LE without BOM: every other byte is NUL in the ASCII range
  if (input.length > 8 && input[1] === 0 && input[3] === 0 && input[0] === 0x3c) return input.toString("utf16le");
  let text = input.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
};

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export const parseXml = (input) => {
  const xml = decodeText(input);
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      stack[stack.length - 1].text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) {
      const chunk = xml.slice(i, lt);
      if (chunk.trim()) stack[stack.length - 1].text += decodeEntities(chunk);
    }
    if (xml.startsWith("<!--", lt)) { const e = xml.indexOf("-->", lt + 4); i = e === -1 ? n : e + 3; continue; }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, e === -1 ? n : e);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (xml[lt + 1] === "?" || xml[lt + 1] === "!") { const e = xml.indexOf(">", lt + 2); i = e === -1 ? n : e + 1; continue; }
    // find tag end honouring quoted attribute values
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const raw = xml.slice(lt + 1, j);
    i = j + 1;
    if (raw[0] === "/") {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const name = (sp === -1 ? body : body.slice(0, sp)).trim();
    const attrs = {};
    if (sp !== -1) {
      ATTR.lastIndex = 0;
      let m;
      const rest = body.slice(sp);
      while ((m = ATTR.exec(rest))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
    }
    const el = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
};

// --- tree helpers --------------------------------------------------------
const localName = (name) => { const k = name.indexOf(":"); return k === -1 ? name : name.slice(k + 1); };

/** Direct children named `name` (namespace prefix ignored, case-insensitive). */
export const kids = (el, name) => {
  const want = name.toUpperCase();
  return (el?.children || []).filter((c) => localName(c.name).toUpperCase() === want);
};
export const kid = (el, name) => kids(el, name)[0] || null;
/** Trimmed text of the first child `name`, or "". */
export const textOf = (el, name) => {
  const c = name ? kid(el, name) : el;
  return c ? c.text.trim() : "";
};
/** All descendants named `name` (depth-first). */
export const findAll = (el, name, out = []) => {
  const want = name.toUpperCase();
  for (const c of el?.children || []) {
    if (localName(c.name).toUpperCase() === want) out.push(c);
    findAll(c, name, out);
  }
  return out;
};
