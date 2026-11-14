// Public document verification (/verify/:hash) — contract 02 §5.3. Anyone
// holding a Satya-issued document's verify link can confirm it is authentic
// without signing in. Shows the safe metadata only.

import Link from "next/link";
import { ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";
import { fetchJson } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Verify a document" };

const TYPE_LABEL: Record<string, string> = {
  PO: "Purchase order", PI_OUT: "Proforma invoice", INVOICE_OUT: "Invoice",
};

type Result = { valid: boolean; type?: string; number?: string; entityName?: string; date?: string; grandTotal?: string; status?: string };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[14px] text-[var(--muted)]">{label}</dt>
      <dd className="text-right text-[15px] font-medium text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  let result: Result;
  let offline = false;
  try {
    result = await fetchJson<Result>(`/api/v2/verify/${encodeURIComponent(hash)}`);
  } catch {
    offline = true;
    result = { valid: false };
  }
  const kind = TYPE_LABEL[result.type ?? ""] ?? "Document";
  const cancelled = result.status === "cancelled";

  const state = offline
    ? { icon: ShieldAlert, color: "var(--sev-medium)", bg: "var(--sev-medium-soft)", title: "Verification is unavailable right now", body: "The verification service could not be reached. Please try this link again in a few minutes." }
    : result.valid
      ? cancelled
        ? { icon: ShieldAlert, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)", title: `This ${kind.toLowerCase()} was issued, then cancelled`, body: "It is genuine but no longer valid — confirm the current document with the issuer." }
        : { icon: ShieldCheck, color: "var(--confirmed)", bg: "var(--confirmed-soft)", title: `This ${kind.toLowerCase()} is genuine`, body: "It matches the issuing company’s records in Satya. If the details below differ from the document you were sent, treat that copy with caution." }
      : { icon: ShieldX, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)", title: "Document not recognised", body: "No Satya-issued document matches this link. It may have been altered or made up — don’t rely on it without confirming with the issuer directly." };
  const Icon = state.icon;

  return (
    <main className="flex min-h-screen flex-col bg-[var(--paper)]">
      <header className="mx-auto flex w-full max-w-md items-center px-6 pt-8">
        <Link href="/" className="text-[15px] font-semibold text-[var(--ink)]">satya</Link>
        <span className="ml-2 text-[14px] text-[var(--muted)]">· document check</span>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-1)] sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: state.bg }}>
            <Icon size={28} style={{ color: state.color }} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-center text-[21px] font-semibold leading-snug text-[var(--ink)]">{state.title}</h1>
          <p className="mt-2 text-center text-[15px] leading-relaxed text-[var(--muted)]">{state.body}</p>
          {result.valid && !offline ? (
            <dl className="mt-6 divide-y divide-[var(--line)] rounded-[var(--radius-md)] border border-[var(--line)] px-4">
              <Row label="Document">{kind} <span className="tnum">{result.number}</span></Row>
              {result.entityName ? <Row label="Issued by">{result.entityName}</Row> : null}
              {result.date ? <Row label="Date"><span className="tnum">{formatDate(result.date)}</span></Row> : null}
              {result.grandTotal ? <Row label="Total"><span className="tnum">{formatMoney(result.grandTotal)}</span></Row> : null}
            </dl>
          ) : null}
        </div>
      </div>
    </main>
  );
}
