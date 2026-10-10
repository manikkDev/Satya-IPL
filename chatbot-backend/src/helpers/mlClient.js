const base = process.env.ML_API_URL || "http://localhost:8000";

const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...internalHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || data.message || `ML service returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const internalHeaders = () => ({
  "content-type": "application/json",
  "x-internal-token": process.env.NODE_INTERNAL_TOKEN || "",
});

export const ml = {
  startFL: (config) => request("/fl/start", { method: "POST", headers: internalHeaders(), body: JSON.stringify(config) }),
  stopFL: (id) => request(`/fl/stop/${encodeURIComponent(id)}`, { method: "POST", headers: internalHeaders() }),
  status: (id) => request(`/fl/status/${encodeURIComponent(id)}`),
  runs: () => request("/fl/runs"),
  summary: () => request("/fl/summary"),
  predict: (body) => request("/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  sample: (dataset, runId, query = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null && value !== undefined));
    return request(`/customers/${encodeURIComponent(dataset)}/${encodeURIComponent(runId)}/sample?${params}`);
  },
  customer: (dataset, runId, customerId, query = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null && value !== undefined));
    return request(`/customers/${encodeURIComponent(dataset)}/${encodeURIComponent(runId)}/${encodeURIComponent(customerId)}?${params}`);
  },
  citizen: (customerRef, runId) => request(`/citizen/${encodeURIComponent(customerRef)}${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`),
  fairness: (runId) => request(`/fairness${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`),
  epsilon: (query = {}) => request(`/privacy/epsilon?${new URLSearchParams(query)}`),
  seedGraph: (runId) => request(`/graph/seed${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`, { method: "POST", headers: internalHeaders() }),
  stream: (runId) => fetch(`${base}/fl/stream/${encodeURIComponent(runId)}`, { headers: internalHeaders() }),
};
