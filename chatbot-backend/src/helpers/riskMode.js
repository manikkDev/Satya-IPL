import { resolveInvestigationMode } from "../prompts/copilotPrompt.js";

export function resolveAuthorizedInvestigationMode(rawMode, user) {
  const requested = resolveInvestigationMode(rawMode);
  const analyst = user?.role === "analyst" || user?.role === "admin";
  const roleMode = analyst ? "risk_analyst" : "risk_citizen";
  // This product exposes only the two financial-risk copilot personas.
  // Legacy threat-intel modes (phishing/url/campaigns/aml) are not reachable
  // through the risk platform API.
  return requested === "copilot" || requested === roleMode ? roleMode : null;
}
