import fetch from "node-fetch";
import env from "../config/env.js";

const GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1";

function buildQuery(base, location) {
  if (!location) return base;
  return `${base} "${location}"`;
}

function safeHandleFromUrl(url, platform) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (platform === "instagram") {
      const handle = parts[0];
      if (!handle || ["explore", "p", "reel", "stories"].includes(handle)) return null;
      return handle;
    }
    if (platform === "linkedin") {
      const idx = parts.findIndex((p) => p === "in" || p === "company");
      if (idx === -1 || !parts[idx + 1]) return null;
      return parts[idx + 1];
    }
    if (platform === "twitter") {
      const handle = parts[0];
      if (!handle || ["home", "search", "explore"].includes(handle)) return null;
      return handle;
    }
    if (platform === "facebook") {
      const handle = parts[0];
      if (
        !handle ||
        ["pages", "people", "watch", "marketplace", "groups"].includes(handle)
      )
        return null;
      return handle;
    }
  } catch (_) {}
  return null;
}

export function isSocialSearchEnabled() {
  return Boolean(env.GOOGLE_API_KEY && env.GOOGLE_CSE_ID);
}

async function runCse(query, num = 3) {
  const apiKey = env.GOOGLE_API_KEY;
  const cseId = env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    console.warn(
      "[socialSearch] Missing GOOGLE_API_KEY or GOOGLE_CSE_ID; skipping social search.",
    );
    return [];
  }

  const url = new URL(GOOGLE_SEARCH_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cseId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(num));
  url.searchParams.set("safe", "active");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[socialSearch] CSE error:", res.status, txt);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    console.warn("[socialSearch] CSE request failed:", err?.message || err);
    return [];
  }
}

export async function searchSocialProfiles(query, options = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  const location = options.location ? String(options.location).trim() : "";

  const platformQueries = [
    {
      key: "instagram",
      label: "Instagram",
      query: buildQuery(`site:instagram.com ${trimmed}`, location),
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      query: buildQuery(
        `site:linkedin.com/in ${trimmed} OR site:linkedin.com/company ${trimmed}`,
        location,
      ),
    },
    {
      key: "twitter",
      label: "X/Twitter",
      query: buildQuery(
        `site:twitter.com ${trimmed} OR site:x.com ${trimmed}`,
        location,
      ),
    },
    {
      key: "facebook",
      label: "Facebook",
      query: buildQuery(`site:facebook.com ${trimmed}`, location),
    },
  ];

  const results = [];
  for (const p of platformQueries) {
    const items = await runCse(p.query, 3);
    const parsed = items
      .map((item) => {
        const url = item?.link;
        if (!url) return null;
        const handle = safeHandleFromUrl(url, p.key);
        if (!handle) return null;
        return {
          handle,
          url,
          title: item?.title || "",
          snippet: item?.snippet || "",
        };
      })
      .filter(Boolean);

    results.push({ platform: p.label, results: parsed });
  }

  return results;
}

export function formatSocialProfiles(results = []) {
  const lines = [];
  const nonEmpty = results.filter((r) => Array.isArray(r?.results) && r.results.length > 0);
  if (nonEmpty.length === 0) return "";
  lines.push("Social profiles (Google CSE):");
  for (const group of nonEmpty) {
    for (const item of group.results) {
      const handleLabel = item.handle ? `@${item.handle}` : "";
      const label = handleLabel ? `${group.platform}: ${handleLabel}` : `${group.platform}`;
      lines.push(`${label} — ${item.url}`);
    }
  }
  return lines.join("\n");
}

export default searchSocialProfiles;
