"use client";

// Confirmation for consequential actions. Irreversible ones require a typed
// reason (it is stored on the audit trail) and say plainly what will happen.

import { useEffect, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn } from "@/components/ui/v2";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  requireReason = false,
  reasonLabel = "Reason (saved to the review history)",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const blocked = requireReason && reason.trim().length < 5;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[17px]">
            {tone === "danger" ? <TriangleAlert size={18} className="text-[var(--sev-critical)]" aria-hidden="true" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-relaxed text-[var(--ink-2)]">{description}</DialogDescription>
        </DialogHeader>
        {requireReason ? (
          <div>
            <label htmlFor="confirm-reason" className="text-[13px] font-medium text-[var(--ink-2)]">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1.5 w-full resize-none rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              placeholder="e.g. Supplier confirmed the balance will not be supplied"
            />
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Btn variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Btn>
          <Btn
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy || blocked}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
