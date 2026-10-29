"use client";

// Cold-start banner (06 §9, 02 §5.1). Render free tier sleeps — the first
// request can take ~a minute. This never blocks the page: it watches the
// liveness endpoint, prefers the detailed /api/v2/meta/health when B ships it,
// and explains plainly what's waking up.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { SERVER_URL } from "@/utils/commonHelper";
import { mocksEnabled } from "@/lib/flags";

type MetaHealth = { server?: string; engine?: string; gateway?: string; mongo?: string; neo4j?: string };

const LABELS: Record<keyof MetaHealth, string> = {
  server: "records", engine: "engine", gateway: "assistant", mongo: "database", neo4j: "graph",
};

export function HealthBanner() {
  const [state, setState] = useState<"ok" | "waking" | "down" | null>(null);
  const [waking, setWaking] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    if (mocksEnabled()) return;
    let live = true;

    const check = async () => {
      try {
        // Detailed per-service health (B's endpoint once shipped).
        let detail: MetaHealth | null = null;
        try {
          const r = await fetch(`${SERVER_URL}/api/v2/meta/health`, { signal: AbortSignal.timeout(8_000) });
          if (r.ok) detail = await r.json();
        } catch { /* meta/health may not exist yet */ }

        const r = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(8_000) });
        if (!live) return;
        if (!r.ok) {
          setState(r.status === 503 ? "waking" : "down");
          setOffline(false);
        } else {
          const wakingList = detail
            ? (Object.keys(LABELS) as (keyof MetaHealth)[]).filter((k) => detail![k] === "waking" || detail![k] === "down")
            : [];
          setWaking(wakingList);
          setState(wakingList.length ? "waking" : "ok");
          setOffline(false);
        }
      } catch {
        if (!live) return;
        setState("waking");
        setOffline(true);
      }
    };

    void check();
    timer.current = setInterval(check, 30_000);
    return () => {
      live = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (!state || state === "ok") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--possible)] bg-[var(--possible-soft)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--ink-2)]"
    >
      {state === "waking" ? (
        <LoaderCircle size={15} className="mt-0.5 shrink-0 animate-spin text-[var(--possible)]" aria-hidden="true" />
      ) : (
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--possible)]" aria-hidden="true" />
      )}
      <span>
        {offline
          ? "Satya's services are waking up — the first request after a quiet spell can take about a minute on the free tier. Nothing is lost; keep working and it will catch up."
          : state === "waking" && waking.length
            ? `${waking.map((k) => LABELS[k as keyof MetaHealth]).join(", ")} ${waking.length === 1 ? "is" : "are"} still warming up — you can keep working.`
            : state === "waking"
              ? "Some services are still warming up — you can keep working."
              : "The service reported a problem. Check the status page or try again in a moment."}
      </span>
    </div>
  );
}
