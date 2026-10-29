// Gateway (chatbot-backend / Agent C) internal client — same conventions as
// services/engine.js: internal token, timeout, UPSTREAM_UNAVAILABLE degrade.
const base = () => (process.env.GATEWAY_API_URL || "http://localhost:5001").replace(/\/$/, "");

const upstream = (status, code, message, details) =>
  Object.assign(new Error(message), { status, code, details });

export const gatewayPost = async (path, body, { timeoutMs = 30000, userToken } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json", "x-internal-token": process.env.NODE_INTERNAL_TOKEN || "" };
    if (userToken) headers.authorization = `Bearer ${userToken}`;
    const response = await fetch(`${base()}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = data?.error || {};
      throw upstream(response.status, err.code || "UPSTREAM_UNAVAILABLE", err.message || `Gateway returned ${response.status}`, { service: "gateway", ...(err.details || {}) });
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw upstream(503, "UPSTREAM_UNAVAILABLE", "AI gateway unavailable", { service: "gateway" });
  } finally {
    clearTimeout(timer);
  }
};
