import { REFERENCES, REFERENCE_GROUPS, type Reference } from "@/content/pitch/references";
import { Cite } from "@/components/pitch/page-shell";

/** Several citations in a row: "(A, 2026; B, 2025)". */
export function Cites({ refs }: { refs: number[] }) {
  const list = refs.map((n) => REFERENCES.find((r) => r.n === n)).filter((r): r is Reference => Boolean(r));
  if (!list.length) return null;
  return (
    <span className="text-[var(--muted)]">
      {list.map((r, i) => (
        <span key={r.n}>
          {i > 0 ? "; " : ""}
          <Cite r={r} />
        </span>
      ))}
    </span>
  );
}

/** Full grouped bibliography from the research report. */
export function ReferenceList({ only }: { only?: number[] }) {
  const pick = only ? new Set(only) : null;
  return (
    <div className="space-y-10">
      {REFERENCE_GROUPS.map((group) => {
        const items = REFERENCES.filter((r) => r.group === group && (!pick || pick.has(r.n)));
        if (!items.length) return null;
        return (
          <div key={group}>
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--ink-2)]">{group}</h3>
            <ol className="mt-3 space-y-2.5">
              {items.map((r) => (
                <li key={r.n} id={`ref-${r.n}`} className="grid grid-cols-[2.5rem_1fr] gap-x-2 text-[14.5px] leading-relaxed text-[var(--ink-2)]">
                  <span className="tnum text-right text-[var(--muted)]">{r.n}.</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {r.text}{" "}
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-[3px]">
                        Link<span className="sr-only"> to reference {r.n} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    {r.notReverified ? (
                      <span className="ml-2 inline-flex rounded-full border border-dashed border-[var(--line-strong)] px-2 py-px text-[11.5px] text-[var(--muted)]">
                        not re-verified
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
