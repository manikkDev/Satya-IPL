// Internal engine client (04 P2-B6 lib/http.js grows from this): internal
// token, timeout, and contract-shaped UPSTREAM_UNAVAILABLE errors — the PO
// compute path must degrade cleanly while the engine's v2 surface rolls out.
const base = () => (process.env.ENGINE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const token = () => process.env.NODE_INTERNAL_TOKEN || "";

const upstream = (status, code, message, details) =>
  Object.assign(new Error(message), { status, code, details });

export const enginePost = async (path, body, { timeoutMs = 10000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": token() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = data?.error || {};
      throw upstream(response.status === 404 ? 503 : response.status,
        err.code || "UPSTREAM_UNAVAILABLE",
        response.status === 404 ? "Engine v2 surface is not enabled yet" : err.message || `Engine returned ${response.status}`,
        { service: "engine", retryAfterMs: 15000, ...(err.details || {}) });
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw upstream(503, "UPSTREAM_UNAVAILABLE", "Engine service is unavailable or still waking up", { service: "engine", retryAfterMs: 15000 });
  } finally {
    clearTimeout(timer);
  }
};

export const engineGet = async (path, { timeoutMs = 8000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base()}${path}`, { headers: { "x-internal-token": token() }, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw upstream(503, "UPSTREAM_UNAVAILABLE", "Engine service is unavailable", { service: "engine", retryAfterMs: 15000 });
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw upstream(503, "UPSTREAM_UNAVAILABLE", "Engine service is unavailable or still waking up", { service: "engine", retryAfterMs: 15000 });
  } finally {
    clearTimeout(timer);
  }
};
