// Turns a raw audit row ("POST /api/v2/documents/doc_x/approve") into plain
// words + a link to the object it touched.

import type { AuditRow } from "@/lib/api/v2-pages";

export type AuditObject = { kind: string; label: string; id?: string; href?: string };
export type AuditDescription = { verb: string; object: AuditObject; method: string; ok: boolean; denied: boolean };

const PO_LIFECYCLE: Record<string, string> = {
  submit: "Sent for approval",
  approve: "Approved",
  reject: "Rejected",
  issue: "Issued",
  amend: "Amended",
  "short-close": "Short-closed",
  cancel: "Cancelled",
  compute: "Recalculated totals",
};

const CASE_VERBS: Record<string, string> = {
  decisions: "Recorded a decision",
  reconcile: "Re-ran the check",
  scenarios: "Tried a what-if",
};

const methodVerb = (method: string) =>
  method === "POST" ? "Created" : method === "PATCH" || method === "PUT" ? "Updated" : method === "DELETE" ? "Deleted" : method || "Changed";

/** Object-type filter options → the API path segment they match. */
export const OBJECT_TYPES: { value: string; label: string; pattern: string }[] = [
  { value: "documents", label: "Orders & documents", pattern: "documents" },
  { value: "cases", label: "Investigations", pattern: "cases" },
  { value: "ingest", label: "Uploads & drafts", pattern: "(ingest|files)" },
  { value: "payments", label: "Payments", pattern: "payments" },
  { value: "compliance", label: "Compliance", pattern: "(compliance|import)" },
  { value: "suppliers", label: "Suppliers & items", pattern: "(suppliers|items)" },
  { value: "settings", label: "Settings", pattern: "(policies|entities)" },
];

export const ACTION_KINDS: { value: string; label: string; pattern: string }[] = [
  { value: "create", label: "Created", pattern: "POST" },
  { value: "change", label: "Changed", pattern: "(PATCH|PUT)" },
  { value: "delete", label: "Deleted", pattern: "DELETE" },
];

/** Server `action` is a regex over "METHOD /api/v2/…". */
export function actionRegex(kind: string, objectType: string): string | undefined {
  const method = ACTION_KINDS.find((a) => a.value === kind)?.pattern;
  const coll = OBJECT_TYPES.find((o) => o.value === objectType)?.pattern;
  if (!method && !coll) return undefined;
  return `^${method ?? "[A-Z]+"} /api/v2/${coll ?? ""}`;
}

export function describeAudit(row: AuditRow): AuditDescription {
  const status = Number(row.statusCode ?? 200);
  const ok = status < 400;
  const denied = status === 401 || status === 403;
  const match = row.action.match(/^([A-Z]+)\s+\/api\/v2\/(.+)$/);
  if (!match) {
    // e.g. "payments.allocate:doc_x"
    const [left, id] = row.action.split(":");
    const [coll, verb] = left.split(".");
    const objectId = id ?? row.target?.id;
    return {
      method: "",
      ok,
      denied,
      verb: verb ? verb.charAt(0).toUpperCase() + verb.slice(1) : left,
      object: coll === "payments" ? { kind: "Payment", label: objectId ?? "payment", id: objectId, href: "/app/payments" } : { kind: coll, label: objectId ?? coll, id: objectId },
    };
  }
  const method = match[1];
  const parts = match[2].split("?")[0].split("/").filter(Boolean);
  const [coll, second, third] = parts;
  const targetId = (row.target?.id as string | undefined) ?? undefined;
  const isId = (s?: string) => Boolean(s && /^[a-z]{2,5}_[A-Za-z0-9_]+$/.test(s));
  const id = targetId ?? (isId(second) ? second : isId(third) ? third : undefined);

  switch (coll) {
    case "documents": {
      if (second === "draft") return { method, ok, denied, verb: "Created a draft order", object: { kind: "Order", label: id ?? "new draft", id, href: id ? `/app/orders/${id}` : undefined } };
      const lifecycle = third ? PO_LIFECYCLE[third] : undefined;
      if (lifecycle) return { method, ok, denied, verb: lifecycle, object: { kind: "Order", label: id ?? "order", id, href: id ? `/app/orders/${id}` : undefined } };
      return { method, ok, denied, verb: third ? third.replaceAll("-", " ") : methodVerb(method), object: { kind: "Document", label: id ?? "document", id, href: id ? `/app/documents/${id}` : undefined } };
    }
    case "cases":
      return {
        method, ok, denied,
        verb: (third && CASE_VERBS[third]) ?? methodVerb(method),
        object: { kind: "Investigation", label: id ?? "investigation", id, href: id ? `/app/investigations/${id}` : undefined },
      };
    case "ingest": {
      if (second === "files") return { method, ok, denied, verb: "Read a file with AI", object: { kind: "Upload", label: third ?? "file", id: third } };
      const verb = parts[3] === "confirm" ? "Confirmed as evidence" : method === "PATCH" ? "Corrected extracted fields" : methodVerb(method);
      return { method, ok, denied, verb, object: { kind: "Upload", label: id ?? "draft", id, href: id ? `/app/documents/${id}` : undefined } };
    }
    case "files":
      return { method, ok, denied, verb: "Uploaded a file", object: { kind: "File", label: id ?? "file", id, href: "/app/documents" } };
    case "payments":
      return { method, ok, denied, verb: third === "allocate" ? "Allocated a payment" : methodVerb(method), object: { kind: "Payment", label: id ?? "payment", id, href: "/app/payments" } };
    case "suppliers":
      return { method, ok, denied, verb: method === "POST" && !second ? "Added a supplier" : methodVerb(method), object: { kind: "Supplier", label: id ?? "supplier", id, href: id ? `/app/suppliers/${id}` : "/app/suppliers" } };
    case "items":
      return { method, ok, denied, verb: method === "POST" && !second ? "Added an item" : methodVerb(method), object: { kind: "Item", label: id ?? "item master", id, href: "/app/settings" } };
    case "compliance": {
      const verbs: Record<string, string> = {
        lut: "Saved a LUT", "tds-decision": "Recorded a TDS decision", "itc-reversal": "Marked an ITC reversal", "gst-meta": "Recorded IRN / e-way details",
      };
      return { method, ok, denied, verb: verbs[second ?? ""] ?? methodVerb(method), object: { kind: "Compliance", label: (second ?? "record").replaceAll("-", " "), href: "/app/compliance" } };
    }
    case "import":
      return { method, ok, denied, verb: second === "gstr2b" ? "Imported GSTR-2B" : second === "bank-csv" ? "Imported a bank statement" : "Imported data", object: { kind: "Import", label: second ?? "import", href: second === "bank-csv" ? "/app/payments" : "/app/compliance" } };
    case "policies":
      return { method, ok, denied, verb: "Changed the entity policy", object: { kind: "Policy", label: id ?? "policy", id, href: "/app/settings" } };
    case "entities":
      return { method, ok, denied, verb: method === "POST" ? "Added an entity" : "Updated an entity", object: { kind: "Entity", label: id ?? "entity", id, href: "/app/settings" } };
    default:
      return { method, ok, denied, verb: methodVerb(method), object: { kind: coll ?? "record", label: id ?? match[2], id } };
  }
}
