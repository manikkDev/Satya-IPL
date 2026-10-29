"use client";

// Feature flags for the v2 rollout. Resolution order per flag:
//   1. NEXT_PUBLIC_FEATURE_V2_<NAME> env override (explicit on/off)
//   2. GET /api/v2/meta/flags on the platform server (resolved server-side)
//   3. NEXT_PUBLIC_USE_MOCKS=1 → all on (local mock development)
//   4. default off (safe for production)
// Flags are fetched once per session and merged; a failed fetch never throws.

import { SERVER_URL } from "@/utils/commonHelper";
import { useEffect, useState } from "react";

export const FEATURE_FLAG_NAMES = [
  "PO_WIZARD",
  "DOC_INBOX",
  "RECON_V2",
  "GRAPH_V2",
  "COPILOT_V2",
  "COMPLIANCE",
  "ML_V2",
  "PUBLIC_SITE_V2",
  "AI_USAGE_METER",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlags = Record<FeatureFlag, boolean>;

const truthy = (value: string | undefined) => value === "1" || value === "true" || value === "on";
const falsy = (value: string | undefined) => value === "0" || value === "false" || value === "off";

export const mocksEnabled = () => truthy(process.env.NEXT_PUBLIC_USE_MOCKS);

function envFlag(name: FeatureFlag): boolean | undefined {
  const raw = process.env[`NEXT_PUBLIC_FEATURE_V2_${name}`];
  if (truthy(raw)) return true;
  if (falsy(raw)) return false;
  return undefined;
}

export function defaultFlags(): FeatureFlags {
  const mocks = mocksEnabled();
  return Object.fromEntries(
    FEATURE_FLAG_NAMES.map((name) => [name, envFlag(name) ?? mocks]),
  ) as FeatureFlags;
}

let cached: Promise<FeatureFlags> | null = null;

export function resolveFeatureFlags(): Promise<FeatureFlags> {
  if (cached) return cached;
  const base = defaultFlags();
  cached = (async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/v2/meta/flags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return base;
      const data = (await response.json()) as { flags?: Partial<FeatureFlags> };
      const merged = { ...base };
      for (const name of FEATURE_FLAG_NAMES) {
        const env = envFlag(name);
        if (env !== undefined) merged[name] = env;
        else if (typeof data.flags?.[name] === "boolean") merged[name] = data.flags[name];
      }
      return merged;
    } catch {
      return base;
    }
  })();
  return cached;
}

/** Test/SSE escape hatch: replace the resolved flag set (e.g. mocks in unit tests). */
export function overrideFeatureFlags(flags: Partial<FeatureFlags>) {
  cached = Promise.resolve({ ...defaultFlags(), ...flags });
}

export function useFeatureFlags(): { flags: FeatureFlags; ready: boolean } {
  const [flags, setFlags] = useState<FeatureFlags>(defaultFlags);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    resolveFeatureFlags().then((resolved) => {
      if (live) {
        setFlags(resolved);
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return { flags, ready };
}

export function useFeatureFlag(name: FeatureFlag): boolean {
  return useFeatureFlags().flags[name];
}
