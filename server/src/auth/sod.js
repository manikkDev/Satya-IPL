// Segregation of duties (01 §8): creator != approver, maker != checker, and
// nobody decides a finding on a document they created. Every denial carries
// a plain-language reason the UI can show directly.

export const SoD = {
  NOT_APPROVER: "You created this document, so another approver must approve it",
  NOT_CHECKER: "You prepared this action, so someone else must check it",
  OWN_FINDING: "You cannot decide a finding on a document you created",
  GRN_INVOICE: "You recorded the receipt for this order, so someone else must approve its invoice",
};

// document: {createdBy|importedBy}, userId: sub of the acting user
export const assertNotCreator = (document, userId, reason = SoD.NOT_APPROVER) =>
  document?.createdBy && document.createdBy === userId ? { ok: false, reason } : { ok: true };

export const makerChecker = (record, userId) =>
  record?.makerId && record.makerId === userId ? { ok: false, reason: SoD.NOT_CHECKER } : { ok: true };

export const sodDeny = (res, reason, requestId) =>
  res.status(403).json({
    error: { code: "SOD_VIOLATION", message: reason, details: { reason }, requestId },
  });
