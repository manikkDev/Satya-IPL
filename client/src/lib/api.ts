import { ENDPOINTS } from "@/config/endpoints";

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const json = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Request failed with ${response.status}`);
  return body;
};

export type RoundEvent = {
  event: "start" | "round" | "end" | "error";
  run_id: string;
  round?: number;
  num_rounds?: number;
  strategy?: string;
  global?: { roc_auc: number; pr_auc: number; f1: number; loss: number; ece: number; recall_at_p90?: number };
  privacy?: { dp_enabled: boolean; epsilon: number | null; delta: number; noise_multiplier: number; clipping_norm: number; secagg: boolean };
  final?: Record<string, unknown>;
};

export const api = {
  fl: {
    start: (config: Record<string, unknown>) => fetch(`${ENDPOINTS.fl}/start`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(config) }).then(json),
    stop: (id: string) => fetch(`${ENDPOINTS.fl}/stop/${encodeURIComponent(id)}`, { method: "POST", headers: authHeaders() }).then(json),
    runs: () => fetch(`${ENDPOINTS.fl}/runs`, { headers: authHeaders() }).then(json),
    status: (id: string) => fetch(`${ENDPOINTS.fl}/status/${encodeURIComponent(id)}`, { headers: authHeaders() }).then(json),
    summary: () => fetch(`${ENDPOINTS.fl}/summary`, { headers: authHeaders() }).then(json),
    predict: (body: unknown) => fetch(`${ENDPOINTS.fl}/predict`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) }).then(json),
    customers: (query: Record<string, string>) => fetch(`${ENDPOINTS.fl}/customers?${new URLSearchParams(query)}`, { headers: authHeaders() }).then(json),
    customer: (id: string, query: Record<string, string>) => fetch(`${ENDPOINTS.fl}/customers/${encodeURIComponent(id)}?${new URLSearchParams(query)}`, { headers: authHeaders() }).then(json),
    citizen: (runId?: string) => fetch(`${ENDPOINTS.fl}/citizen${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`, { headers: authHeaders() }).then(json),
    fairness: (runId?: string) => fetch(`${ENDPOINTS.fl}/fairness${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`, { headers: authHeaders() }).then(json),
    epsilon: (noise: number, rounds: number, targetEpsilon?: number) =>
      fetch(`${ENDPOINTS.fl}/epsilon?noise=${noise}&rounds=${rounds}${targetEpsilon ? `&target_epsilon=${targetEpsilon}` : ""}`, { headers: authHeaders() }).then(json),
    seedGraph: (runId?: string) => fetch(`${ENDPOINTS.fl}/graph/seed`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ run_id: runId }) }).then(json),
    stream: (id: string, onEvent: (event: RoundEvent) => void) => {
      const controller = new AbortController();
      fetch(ENDPOINTS.flStream(id), { headers: authHeaders(), signal: controller.signal }).then(async (response) => {
        if (!response.ok || !response.body) throw new Error(`Training stream failed with ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            const line = block.split(/\r?\n/).find((entry) => entry.startsWith("data:"));
            if (line) onEvent(JSON.parse(line.slice(5).trim()));
          }
        }
      }).catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      });
      return () => controller.abort();
    },
  },
  graph: {
    meta: () => fetch(ENDPOINTS.riskGraphMeta, { headers: authHeaders() }).then(json),
    overview: (minScore = 0.3, limit = 400) => fetch(`${ENDPOINTS.riskGraphOverview}?minScore=${minScore}&limit=${limit}`, { headers: authHeaders() }).then(json),
    campaigns: () => fetch(ENDPOINTS.riskGraphCampaigns, { headers: authHeaders() }).then(json),
    campaign: (id: number) => fetch(ENDPOINTS.riskGraphCampaign(id), { headers: authHeaders() }).then(json),
    neighbors: (pid: string) => fetch(ENDPOINTS.riskGraphNeighbors(pid), { headers: authHeaders() }).then(json),
  },
  consent: {
    me: () => fetch(`${ENDPOINTS.consent}/me`, { headers: authHeaders() }).then(json),
    set: (purpose: string, granted: boolean) => fetch(ENDPOINTS.consent, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ purpose, granted }) }).then(json),
    erase: () => fetch(`${ENDPOINTS.consent}/erase-request`, { method: "POST", headers: authHeaders() }).then(json),
    exportData: async () => {
      const response = await fetch(`${ENDPOINTS.consent}/export`, { headers: authHeaders() });
      const body = await json(response);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `arth-saathi-data-export-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return body;
    },
  },
  audit: {
    list: (limit = 100) => fetch(`${ENDPOINTS.audit}?limit=${limit}`, { headers: authHeaders() }).then(json),
  },
};
