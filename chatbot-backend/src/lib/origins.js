// CORS origin allow-list (copy of server/src/lib/origins.js — keep in sync).
//
// ALLOWED_ORIGINS is a comma list of exact origins plus optional wildcard
// entries for preview deployments, e.g.
//   https://satya-ipl.vercel.app,https://satya-ipl-*.vercel.app
// A "*" is only honoured inside the FIRST host label and matches
// [a-z0-9-]* — it can never cross a dot, change the scheme or add a port.
// Matching is on the parsed origin, never by substring.

const DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normaliseOrigin = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
};

/** Compile one wildcard entry to an anchored regex, or null when unsafe. */
export const compileOriginPattern = (entry) => {
  const m = /^(https?):\/\/([^/:?#@]+)(?::(\d+))?\/?$/i.exec(entry.trim());
  if (!m) return null;
  const [, scheme, host, port] = m;
  const labels = host.toLowerCase().split(".");
  if (labels.length < 3 || labels.slice(1).some((l) => l.includes("*"))) return null;
  if ((labels[0].match(/\*/g) || []).length !== 1) return null;
  const first = labels[0].split("*").map(escapeRe).join("[a-z0-9-]*");
  const rest = labels.slice(1).map(escapeRe).join("\\.");
  return new RegExp(`^${scheme.toLowerCase()}:\\/\\/${first}\\.${rest}${port ? `:${port}` : ""}$`);
};

export const parseAllowedOrigins = (raw = process.env.ALLOWED_ORIGINS) => {
  const entries = String(raw || DEFAULT_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);
  const exact = new Set();
  const patterns = [];
  for (const entry of entries) {
    if (entry.includes("*")) {
      const re = compileOriginPattern(entry);
      if (re) patterns.push(re);
      else console.warn(`[cors] ignoring unsafe ALLOWED_ORIGINS pattern: ${entry}`);
    } else {
      const origin = normaliseOrigin(entry);
      if (origin) exact.add(origin);
    }
  }
  return { exact, patterns };
};

export const makeOriginChecker = (raw) => {
  const { exact, patterns } = parseAllowedOrigins(raw);
  return (origin) => {
    if (!origin) return true; // same-origin / server-to-server
    const normalised = normaliseOrigin(origin);
    if (!normalised) return false;
    return exact.has(normalised) || patterns.some((re) => re.test(normalised));
  };
};
