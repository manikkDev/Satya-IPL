// Low-level JSON client for v2 APIs (docs/plan/06 §8, 02 §2).
// - 15 s default timeout, JWT from localStorage, {code,message} error shape
// - one retry on 503 honouring retryAfterMs (Render cold starts)

import { SERVER_URL } from "@/utils/commonHelper";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  requestId?: string;
  retryAfterMs?: number;

  constructor(status: number, body: unknown) {
    const error = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown>; requestId?: string } })?.error;
    super(error?.message || `Request failed (${status})`);
    this.code = error?.code || "REQUEST_FAILED";
    this.status = status;
    this.details = error?.details;
    this.requestId = error?.requestId;
    const retry = error?.details?.retryAfterMs;
    this.retryAfterMs = typeof retry === "number" ? retry : undefined;
  }
}

const authHeader = (): Record<string, string> =>
  typeof window !== "undefined" && localStorage.getItem("token")
    ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
    : {};

export type FetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
  auth?: boolean;
};

async function once<T>(base: string, path: string, options: FetchOptions): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.auth === false ? {} : authHeader()),
    ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
  };
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string, options: FetchOptions = {}, base = SERVER_URL): Promise<T> {
  try {
    return await once<T>(base, path, options);
  } catch (error) {
    // Cold start: retry once after the server's suggested delay.
    if (error instanceof ApiError && error.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(error.retryAfterMs ?? 3000, 10_000)));
      return once<T>(base, path, options);
    }
    throw error;
  }
}
