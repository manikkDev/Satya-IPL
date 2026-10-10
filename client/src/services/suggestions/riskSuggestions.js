import Fuse from 'fuse.js';

// Role-aware prompt suggestions for the risk copilot — each entry maps to a
// deterministic tool intent on the backend, so suggestions never dead-end.
export const analystSuggestions = [
  "What is the current federated model performance?",
  "Show me the PR-AUC and calibration of the promoted run",
  "Compare federated vs isolated bank performance",
  "Is secure aggregation real or simulated in the latest run?",
  "How much privacy budget (epsilon) did the last DP run spend?",
  "Show me the run history",
  "Who is at the top of my institution's risk queue?",
  "Pull the case for customer C1234567890",
  "Draft a case note for customer C1234567890",
  "Which accounts are linked to customer C1234567890?",
  "Show me detected fraud campaigns in the graph",
  "Is the model fair across institutions?",
  "What is the false-positive burden at 90% precision?",
  "Explain recall at fixed precision for the current model",
  "What does the VFL split-network demo show?",
  "Which features drive the model's risk scores?",
  "Summarise the privacy guarantees of the latest run",
  "What does non-IID data do to federated training?",
];

export const citizenSuggestions = [
  "What is my risk score and why?",
  "Why was my transaction flagged?",
  "Explain my risk band in plain language",
  "What is the difference between my score and my probability?",
  "What consent have I granted?",
  "How do I withdraw consent for risk scoring?",
  "Help me draft a data-rights request",
  "How do I export my data?",
  "What happens if I request erasure?",
  "Does any institution see my raw data?",
  "What does this platform do with my information?",
  "How is my account shown to bank analysts?",
];

const byMode = {
  risk_analyst: analystSuggestions,
  risk_citizen: citizenSuggestions,
};

const fuseCache = {};
const fuseFor = (mode) => {
  if (!fuseCache[mode]) {
    fuseCache[mode] = new Fuse((byMode[mode] || analystSuggestions).map((q) => ({ $: q })), {
      includeScore: true,
      threshold: 0.6,
      minMatchCharLength: 2,
      keys: ['$'],
    });
  }
  return fuseCache[mode];
};

export const riskFuzzySearch = (query, mode) =>
  fuseFor(mode).search(query).map((result) => result.item.$);

export const defaultSuggestions = (mode) => (byMode[mode] || analystSuggestions).slice(0, 5);
