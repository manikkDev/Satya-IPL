// Public document verification (/verify/:hash) — contract 02 §5.3. Anyone
// holding a Satya-issued document's verify link can confirm it is authentic
// without signing in. Shows the safe metadata only.

import { ShieldCheck, ShieldX } from "lucide-react";
import { fetchJson } from "@/lib/api/client";

export const metadata = { title: "Verify document — Satya" };

const TYPE_LABEL: Record<string, string> = {
  PO: "Purchase order", PI_OUT: "Proforma invoice", INVOICE_OUT: "Invoice",
};

export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  let result: { valid: boolean; type?: string; number?: string; entityName?: string; date?: string; grandTotal?: string; status?: string };
  let offline = false;
  try {
    result = await fetchJson(`/api/v2/verify/${encodeURIComponent(hash)}`);
  } catch {
    offline = true;
    result = { valid: false };
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf7f2] p-6 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-[#e3ddd4] bg-white p-8 shadow-sm">
        {offline ? (
          <>
            <ShieldX size={36} className="mx-auto text-[#b45309]" aria-hidden="true" />
            <h1 className="mt-4 text-center text-lg font-semibold text-[#1d1a16]">Verification unavailable</h1>
            <p className="mt-2 text-center text-sm text-[#6b6357]">
              The verification service could not be reached right now. Please try again in a moment.
            </p>
          </>
        ) : result.valid ? (
          <>
            <ShieldCheck size={36} className="mx-auto text-[#15803d]" aria-hidden="true" />
            <h1 className="mt-4 text-center text-lg font-semibold text-[#1d1a16]">
              This {TYPE_LABEL[result.type ?? ""]?.toLowerCase() ?? "document"} is authentic
            </h1>
            <dl className="mt-5 space-y-2.5 rounded-xl bg-[#faf7f2] p-4 text-sm">
              <div className="flex justify-between"><dt className="text-[#6b6357]">Document</dt><dd className="font-code font-medium text-[#1d1a16]">{result.number}</dd></div>
              <div className="flex justify-between"><dt className="text-[#6b6357]">Issued by</dt><dd className="text-[#1d1a16]">{result.entityName}</dd></div>
              <div className="flex justify-between"><dt className="text-[#6b6357]">Date</dt><dd className="text-[#1d1a16]">{result.date}</dd></div>
              {result.grandTotal && (
                <div className="flex justify-between"><dt className="text-[#6b6357]">Grand total</dt><dd className="tnum font-medium text-[#1d1a16]">₹{result.grandTotal}</dd></div>
              )}
              {result.status === "cancelled" && (
                <p className="pt-2 text-center text-xs font-medium text-[#b91c1c]">This document was later cancelled.</p>
              )}
            </dl>
            <p className="mt-4 text-center text-xs leading-relaxed text-[#8a8071]">
              Verified against the issuing company&apos;s records by Satya. If the details differ from the document
              you were sent, treat it with caution.
            </p>
          </>
        ) : (
          <>
            <ShieldX size={36} className="mx-auto text-[#b91c1c]" aria-hidden="true" />
            <h1 className="mt-4 text-center text-lg font-semibold text-[#1d1a16]">Document not recognised</h1>
            <p className="mt-2 text-center text-sm leading-relaxed text-[#6b6357]">
              No Satya-issued document matches this link. It may be altered, expired, or fabricated — do not rely on
              the document without confirming with the issuer directly.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
