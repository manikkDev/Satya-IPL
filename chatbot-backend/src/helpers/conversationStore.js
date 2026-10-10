const base = () => process.env.GRAPH_API_URL || "http://localhost:5002";

const request = async (req, path, options = {}) => {
  const response = await fetch(`${base()}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: req.headers.authorization || "",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Conversation API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
};

export const conversations = {
  profile: (req) => request(req, "/api/auth/profile"),
  list: (req) => request(req, "/api/conversations"),
  create: (req, title) => request(req, "/api/conversations", { method: "POST", body: JSON.stringify({ title }) }),
  get: (req, id) => request(req, `/api/conversations/${encodeURIComponent(id)}`),
  append: (req, id, messages) => request(req, `/api/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  }),
  remove: (req, id) => request(req, `/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
