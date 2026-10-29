// serverCall.js — thin authenticated fetch to the platform API (Agent B).
// Forwards the USER's JWT so server-side RBAC always applies, plus the
// internal token for service-to-service calls. Tools degrade to
// {ok:false} results instead of throwing — the pipeline keeps answering.

const TIMEOUT_MS = 12_000;

export function createServerCall({ base, userToken, fetchImpl } = {}) {
  const root = base || process.env.GRAPH_API_URL || "http://localhost:5002";
  const doFetch = fetchImpl || fetch;
  return async function call(path, { method = "GET", body } = {}) {
    try {
      const response = await doFetch(`${root}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: userToken ? `Bearer ${userToken}` : "",
          "x-internal-token": process.env.NODE_INTERNAL_TOKEN || "",
          "x-request-id": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        /* empty/non-JSON body */
      }
      if (!response.ok) {
        return { ok: false, status: response.status, error: data?.error?.code || `HTTP_${response.status}`, data };
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, error: error?.name === "TimeoutError" || error?.name === "AbortError" ? "TIMEOUT" : "UNREACHABLE", data: null };
    }
  };
}
