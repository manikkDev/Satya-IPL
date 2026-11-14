"use client";

// Answer rendering: markdown with reading typography, numbered citation chips
// with hover/focus preview cards, clean mini-tables with CSV export, editable
// draft blocks (":::draft Title … :::"), a "How we calculated" panel, and a
// soft per-word fade for text revealed while streaming.

import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Calculator, Check, ChevronDown, Copy, Download, Mail, PenLine } from "lucide-react";
import type { Citation } from "@/lib/api/copilot";
import { getCitationPreview, downloadText } from "@/lib/api/copilot";
import { inr, shortDate } from "./format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ parsing */

type Segment =
  | { kind: "md"; text: string }
  | { kind: "draft"; title: string; body: string; open: boolean }
  | { kind: "working"; text: string };

/** Split an answer into prose, draft blocks and the "How we calculated" panel. */
export function segmentAnswer(raw: string, streaming: boolean): { segments: Segment[]; evidence: string[] } {
  let text = raw.replace(/\r/g, "");
  // the evidence line becomes the sources row under the answer
  const evidence: string[] = [];
  text = text.replace(/^\s*_Evidence:_\s*(.*)$/gim, (_m, refs: string) => {
    for (const r of refs.matchAll(/\[S(\d+)\]/g)) evidence.push(`S${r[1]}`);
    return "";
  });
  // while streaming, hide half-typed markup at the very end
  if (streaming) {
    text = text.replace(/\[S?\d*$/, "").replace(/_Evid[\w:]*$/, "");
    if ((text.match(/\*\*/g) || []).length % 2 === 1) text = text.replace(/\*\*(?![\s\S]*\*\*)/, "");
  }
  const segments: Segment[] = [];
  const workingAt = text.search(/^\*\*How we calculated\*\*\s*$/m);
  let working = "";
  if (workingAt >= 0) {
    working = text.slice(workingAt).replace(/^\*\*How we calculated\*\*\s*/m, "");
    text = text.slice(0, workingAt);
  }
  const re = /^:::draft[ \t]*(.*)\n([\s\S]*?)(?:^:::[ \t]*$|$(?![\s\S]))/gm;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: "md", text: text.slice(last, start) });
    const closed = /\n:::[ \t]*$/.test(m[0]);
    segments.push({ kind: "draft", title: m[1].trim() || "Draft", body: m[2].replace(/\n?:::[ \t]*$/, "").trimEnd(), open: !closed });
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "md", text: text.slice(last) });
  if (working.trim()) segments.push({ kind: "working", text: working.trim() });
  return { segments: segments.filter((s) => s.kind !== "md" || s.text.trim()), evidence };
}

/** Number citations by first use when the server list isn't here yet (streaming). */
export function citationNumbers(text: string, citations: Citation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of citations) map.set(c.ref, c.n);
  let n = citations.length ? Math.max(...citations.map((c) => c.n)) : 0;
  for (const m of text.matchAll(/\[S(\d+)\]/g)) {
    const ref = `S${m[1]}`;
    if (!map.has(ref) && !citations.length) map.set(ref, ++n);
  }
  return map;
}

/* --------------------------------------------- per-word fade (streaming) */

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> };

/** Wrap each word of text nodes in <span class="sx-w"> so new words fade in. */
function rehypeWordFade() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!node.children || node.tagName === "code" || node.tagName === "pre" || node.tagName === "a") return;
      const out: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value && child.value.trim()) {
          for (const part of child.value.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) out.push({ type: "text", value: part });
            else out.push({ type: "element", tagName: "span", properties: { className: ["sx-w"] }, children: [{ type: "text", value: part }] });
          }
        } else {
          walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
  };
}

/* ------------------------------------------------------------ citations */

function CitationChip({ n, citation }: { n: number; citation?: Citation }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const preview = useQuery({
    queryKey: ["copilot-cite", citation?.kind, citation?.id],
    queryFn: () => getCitationPreview(citation as Citation),
    enabled: open && Boolean(citation),
    staleTime: 5 * 60_000,
  });
  const show = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const chip = "sx-cite mx-[2px] inline-flex h-[18px] min-w-[18px] -translate-y-[2px] items-center justify-center rounded-[6px] px-1 align-middle text-[11px] font-semibold leading-none no-underline transition-colors";
  if (!citation) return <span className={cn(chip, "bg-[var(--surface-2)] text-[var(--muted)]")} aria-label={`Source ${n}`}>{n}</span>;
  const p = preview.data;
  return (
    <span className="relative inline-block" onMouseEnter={() => show(160)} onMouseLeave={hide}>
      <Link
        href={citation.href}
        aria-describedby={open ? id : undefined}
        aria-label={`Source ${n}: ${citation.label}`}
        onFocus={() => show(0)}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(chip, "bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] focus-visible:bg-[var(--accent)] focus-visible:text-[var(--on-accent)] focus-visible:outline-none")}
      >
        {n}
      </Link>
      {open && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={() => show(0)}
          onMouseLeave={hide}
          className="sx-fade absolute bottom-[calc(100%+8px)] left-1/2 z-40 block w-[260px] -translate-x-1/2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 text-left text-[13px] leading-snug shadow-[var(--shadow-3)]"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{p?.kindLabel ?? "Source"} · {n}</span>
          <span className="mt-1 block font-semibold text-[var(--ink)]">{p?.number || p?.title || citation.label}</span>
          {preview.isLoading ? (
            <span className="mt-2 block h-3 w-40 animate-pulse rounded bg-[var(--surface-2)]" />
          ) : (
            <span className="mt-1 block space-y-0.5 text-[var(--ink-2)]">
              {p?.party ? <span className="block">{p.party}</span> : null}
              {p?.amount || p?.date ? (
                <span className="block tnum">
                  {p.amount ? inr(p.amount) : null}
                  {p.amount && p.date ? " · " : null}
                  {p.date ? shortDate(p.date) : null}
                </span>
              ) : null}
              {p?.status ? <span className="block text-[12px] capitalize text-[var(--muted)]">{String(p.status).replaceAll("_", " ")}</span> : null}
            </span>
          )}
          <Link href={citation.href} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent-strong)] hover:underline">
            Open <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------------- tables */

function ProseTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const exportCsv = () => {
    const table = ref.current?.querySelector("table");
    if (!table) return;
    const cell = (t: string) => (/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : /^[=+\-@]/.test(t) && !/^-?\d/.test(t) ? `'${t}` : t);
    const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => cell((c.textContent || "").trim())).join(","));
    downloadText("satya-table.csv", `﻿${rows.join("\r\n")}\r\n`);
  };
  return (
    <div className="my-4 overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--surface)]">
      <div ref={ref} className="sx-scroll overflow-x-auto">
        <table className="w-full border-collapse text-[14px] [&_td]:border-t [&_td]:border-[var(--line)] [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[12.5px] [&_th]:font-medium [&_th]:text-[var(--muted)] [&_tr:hover_td]:bg-[var(--surface-2)]/50">
          {children}
        </table>
      </div>
      <div className="flex justify-end border-t border-[var(--line)] px-2 py-1.5">
        <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]">
          <Download size={13} aria-hidden="true" /> Export CSV
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- draft */

export function DraftBlock({ title, body, live }: { title: string; body: string; live?: boolean }) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(body), [body]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 520)}px`;
  }, [text]);
  const subject = /^Subject:\s*(.+)$/m.exec(text)?.[1] ?? title;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <section className="sx-rise my-4 overflow-hidden rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[var(--shadow-1)]" aria-label={`Draft: ${title}`}>
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
        <PenLine size={15} className="text-[var(--accent)]" aria-hidden="true" />
        <span className="text-[14px] font-semibold text-[var(--ink)]">{title}</span>
        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">Draft · editable</span>
        <span className="ml-auto flex items-center gap-1">
          <a
            href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.replace(/^Subject:.*\n+/m, ""))}`}
            className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
          >
            <Mail size={13} aria-hidden="true" /> <span className="hidden sm:inline">Email</span>
          </a>
          <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]">
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </header>
      {live ? (
        <p className="whitespace-pre-wrap px-4 py-3 text-[15px] leading-relaxed text-[var(--ink-2)]">{body}<span className="sx-caret" aria-hidden="true" /></p>
      ) : (
        <label className="block">
          <span className="sr-only">Edit the draft</span>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="block w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-[var(--ink-2)] focus:bg-[var(--surface-2)]/40 focus:outline-none"
          />
        </label>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- working */

function WorkingPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  const lines = text.split("\n").filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s/, ""));
  const note = text.split("\n").find((l) => /^_.*_$/.test(l.trim()))?.trim().replace(/^_|_$/g, "");
  const plain = !lines.length ? text.replace(/^_|_$/g, "") : null;
  return (
    <section className="sx-rise my-4 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)]/45">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] font-semibold text-[var(--ink)]">
        <Calculator size={15} className="text-[var(--accent)]" aria-hidden="true" /> How we calculated
        <ChevronDown size={14} className={cn("ml-auto text-[var(--muted)] transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="sx-fade border-t border-[var(--line)] px-4 py-3">
          {plain ? <p className="text-[14px] text-[var(--ink-2)]">{plain}</p> : (
            <ul className="space-y-1.5">
              {lines.map((l, i) => {
                const [label, expr] = /^([^:=]{3,80}):\s(.+)$/.test(l) ? [l.split(": ")[0], l.slice(l.indexOf(": ") + 2)] : [null, l];
                return (
                  <li key={i} className="text-[14px] leading-snug">
                    {label ? <span className="block text-[12.5px] text-[var(--muted)]">{label}</span> : null}
                    <span className="tnum font-medium text-[var(--ink)]">{expr}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {note ? <p className="mt-2.5 text-[12.5px] text-[var(--muted)]">{note}</p> : null}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- render */

const isStrongOnly = (children: ReactNode) => {
  const items = Children.toArray(children).filter((c) => !(typeof c === "string" && !c.trim()));
  return items.length === 1 && isValidElement(items[0]) && (items[0].type === "strong" || (items[0].props as { node?: { tagName?: string } })?.node?.tagName === "strong");
};

function MarkdownBlock({ text, citeMap, citations, lead, fade }: { text: string; citeMap: Map<string, number>; citations: Citation[]; lead: boolean; fade: boolean }) {
  const prepared = useMemo(
    () => text.replace(/\s?\[S(\d+)\]/g, (_m, n) => {
      const num = citeMap.get(`S${n}`);
      return num ? ` [${num}](cite:S${n})` : "";
    }),
    [text, citeMap],
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={fade ? [rehypeWordFade] : []}
      urlTransform={(url) => url}
      components={{
        p: ({ node, children }) => {
          if (lead && node?.position?.start.offset === 0) return <p className="sx-lead">{children}</p>;
          if (isStrongOnly(children)) return <h4 className="sx-h">{children}</h4>;
          return <p>{children}</p>;
        },
        a: ({ href, children }) => {
          if (href === "caret:") return <span className="sx-caret" aria-hidden="true" />;
          if (href?.startsWith("cite:")) {
            const ref = href.slice(5);
            return <CitationChip n={citeMap.get(ref) ?? 0} citation={citations.find((c) => c.ref === ref)} />;
          }
          const safe = href && (href.startsWith("/") || /^https?:\/\//.test(href)) ? href : undefined;
          return safe ? <a href={safe}>{children}</a> : <span>{children}</span>;
        },
        table: ({ children }) => <ProseTable>{children}</ProseTable>,
      }}
    >
      {prepared}
    </ReactMarkdown>
  );
}

export function Prose({ text, citations = [], streaming = false, fade = false }: { text: string; citations?: Citation[]; streaming?: boolean; fade?: boolean }) {
  const { segments } = useMemo(() => segmentAnswer(text, streaming), [text, streaming]);
  const citeMap = useMemo(() => citationNumbers(text, citations), [text, citations]);
  const lastKind = segments.at(-1)?.kind;
  return (
    <div className="sx-prose">
      {segments.map((s, i) => {
        if (s.kind === "draft") return <DraftBlock key={`d${i}`} title={s.title} body={s.body} live={streaming && s.open} />;
        if (s.kind === "working") return <WorkingPanel key={`w${i}`} text={s.text} />;
        // the caret rides at the end of the text being written
        const withCaret = streaming && i === segments.length - 1 ? `${s.text.trimEnd()} [\u200b](caret:)` : s.text;
        return <MarkdownBlock key={`m${i}`} text={withCaret} citeMap={citeMap} citations={citations} lead={i === 0} fade={fade} />;
      })}
      {streaming && (!segments.length || lastKind === "working") ? <span className="sx-caret" aria-hidden="true" /> : null}
    </div>
  );
}
