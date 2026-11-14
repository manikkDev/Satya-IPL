"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComposerHandle = { focus: () => void };

/**
 * Enter sends · Shift+Enter new line · Esc stops a running answer ·
 * ↑ in an empty box recalls your last question.
 */
export const Composer = forwardRef<ComposerHandle, {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  lastQuestion?: string;
  placeholder?: string;
}>(function Composer({ value, onChange, onSend, onStop, busy, lastQuestion, placeholder }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  // auto-grow up to ~8 lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSend();
      }}
      className="rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-[var(--shadow-2)] transition-shadow focus-within:border-[var(--accent)]/60 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]"
    >
      <div className="flex items-end gap-2">
        <label htmlFor="ask-input" className="sr-only">Ask Satya</label>
        <textarea
          id="ask-input"
          ref={area}
          value={value}
          rows={1}
          maxLength={2000}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy && value.trim()) onSend();
            } else if (e.key === "Escape" && busy) {
              e.preventDefault();
              onStop();
            } else if (e.key === "ArrowUp" && !value && lastQuestion) {
              e.preventDefault();
              onChange(lastQuestion);
            }
          }}
          placeholder={placeholder ?? "Ask about a supplier, invoice, payment or deadline…"}
          className="max-h-[220px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15.5px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
        />
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop answering (Esc)" title="Stop (Esc)" className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] text-[var(--ink)] hover:bg-[var(--surface-2)]">
            <Square size={14} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" disabled={!value.trim()} aria-label="Send (Enter)" title="Send (Enter)" className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-40")}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
});
