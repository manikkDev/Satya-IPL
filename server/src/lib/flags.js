// Feature flags for the v2 rollout. Every v2 capability is additive behind
// FEATURE_V2_<NAME>; unset means off in production, on in development so
// local work always exercises the new paths.
export const FLAG_NAMES = [
  "PO_WIZARD",
  "DOC_INBOX",
  "RECON_V2",
  "GRAPH_V2",
  "COPILOT_V2",
  "COMPLIANCE",
  "ML_V2",
  "PUBLIC_SITE_V2",
  "AI_USAGE_METER",
];

const truthy = (value) => value === "1" || value === "true" || value === "on";

export const isOn = (name) => {
  const raw = process.env[`FEATURE_V2_${name}`];
  if (raw !== undefined) return truthy(raw);
  return process.env.NODE_ENV !== "production";
};

export const allFlags = () => Object.fromEntries(FLAG_NAMES.map((name) => [name, isOn(name)]));
