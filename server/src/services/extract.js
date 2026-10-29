import ExtractionDraft from "../models/ExtractionDraft.js";
import { enginePost } from "./engine.js";
import { gatewayPost } from "./gateway.js";
import { getFileBuffer } from "./storage.js";
import { ensurePolicy } from "./policies.js";

// Extraction orchestration (04 P2-B5): engine parse -> optional gateway LLM
// (only when needsLlm AND data policy allows) -> engine validate -> draft.
// Deterministic failure = "failed"; an unavailable LLM NEVER blocks review
// (degrades to needs_review with whatever text-layer extraction found).
const dataPolicy = () => process.env.AI_DATA_POLICY || "demo";

export const runExtraction = async (draft, file) => {
  try {
    await ExtractionDraft.updateOne({ id: draft.id }, { $set: { status: "parsing" } });
    const buffer = await getFileBuffer(file);
    const parsed = await enginePost("/v2/docs/parse", {
      fileBase64: buffer.toString("base64"), mime: file.mime,
    }, { timeoutMs: 30000 });

    let extracted = parsed.extracted || {};
    let method = parsed.method || "text_layer";
    let aiUsage;
    const issues = [...(parsed.issues || [])];

    if (parsed.needsLlm) {
      await ExtractionDraft.updateOne({ id: draft.id }, { $set: { status: "extracting" } });
      try {
        const llm = await gatewayPost("/internal/llm/extract", {
          task: parsed.detectedType?.toLowerCase() || "generic",
          text: parsed.textLayer?.chars ? undefined : undefined,
          pageImages: parsed.pageImages,
          schemaVersion: "v1",
          dataPolicy: dataPolicy(),
        });
        extracted = { ...extracted, ...(llm.extracted || {}) };
        method = "vision_llm";
        aiUsage = llm.usage;
      } catch (err) {
        issues.push({ code: "LLM_UNAVAILABLE", severity: "warning", message: "AI reading unavailable — extracted fields may be incomplete; review carefully" });
      }
    }

    const validated = await enginePost("/v2/docs/validate", {
      draft: extracted, qrFields: parsed.qr?.fields, textLayer: parsed.textLayer?.chars ? "present" : undefined,
    }, { timeoutMs: 15000 }).catch((err) => {
      issues.push({ code: "VALIDATE_SKIPPED", severity: "warning", message: "Field validation unavailable" });
      return { fields: {}, lines: extracted.lines || [], issues: [], suggestions: {} };
    });

    const policy = await ensurePolicy(draft.entityId, draft.groupId).catch(() => null);
    const fields = validated.fields || {};
    const confidences = Object.values(fields).map((f) => Number(f?.confidence ?? 0));
    const hardIssues = [...(validated.issues || [])].filter((i) => i.severity === "error");
    const autoOk = policy?.autoConfirmHighConfidence === true && confidences.length > 0 && confidences.every((c) => c >= 0.95) && hardIssues.length === 0;

    await ExtractionDraft.updateOne({ id: draft.id }, {
      $set: {
        status: autoOk ? "needs_review" : "needs_review", // auto-confirm happens at /confirm step below
        detectedType: parsed.detectedType || extracted.type,
        method,
        fields,
        lines: validated.lines || extracted.lines || [],
        issues: [...issues, ...(validated.issues || [])],
        suggestions: validated.suggestions || {},
        aiUsage,
      },
    });
    return { autoOk };
  } catch (error) {
    await ExtractionDraft.updateOne({ id: draft.id }, {
      $set: { status: "failed", method: "failed", issues: [{ code: error.code || "EXTRACTION_FAILED", severity: "error", message: error.message }] },
    });
    return { autoOk: false, error };
  }
};
