/**
 * endpoints.js
 *
 * Centralized backend endpoint configuration.
 *
 * Architecture:
 * - MAIN_API: chatbot gateway backend (port 5001) - chat, copilot, ML/FL proxy
 * - GRAPH_API: application server (port 5002) - auth, consent, audit, Neo4j graph, Socket.IO
 * - ML_API: Python ML service (port 8000) - models, datasets, inference
 */

// Main backend (primary product backend)
export const MAIN_API = process.env.MAIN_API_URL || 
                        process.env.NEXT_PUBLIC_MAIN_API_URL || 
                        'http://localhost:5001';

// Application/graph backend
export const GRAPH_API = process.env.NEXT_PUBLIC_GRAPH_API_URL || 
                         'http://localhost:5002';

// ML service
export const ML_API = process.env.NEXT_PUBLIC_ML_API_URL || 
                      'http://localhost:8000';

// Convenience exports for common patterns
export const ENDPOINTS = {
  // Chat & Conversations
  chat: `${MAIN_API}/api/chat`,
  chatStream: `${MAIN_API}/api/chat/stream`,
  conversations: `${MAIN_API}/api/conversations`,
  
  // Auth
  auth: `${GRAPH_API}/api/auth`,
  users: `${GRAPH_API}/api/users`,

  // Federated learning
  fl: `${MAIN_API}/api/fl`,
  flStream: (runId) => `${MAIN_API}/api/fl/stream/${runId}`,

  // Risk graph
  riskGraphMeta: `${GRAPH_API}/api/risk-graph/meta`,
  riskGraphOverview: `${GRAPH_API}/api/risk-graph/overview`,
  riskGraphCampaigns: `${GRAPH_API}/api/risk-graph/campaigns`,
  riskGraphCampaign: (id) => `${GRAPH_API}/api/risk-graph/campaign/${id}`,
  riskGraphNeighbors: (pid) => `${GRAPH_API}/api/risk-graph/account/${pid}/neighbors`,

  // Privacy and accountability
  consent: `${GRAPH_API}/api/consent`,
  audit: `${GRAPH_API}/api/audit`,
};

// Export individual APIs for backward compatibility
export const SERVER_URL_1 = MAIN_API;  // Preferred name going forward
export const SERVER_URL = GRAPH_API;    // Legacy name, will be phased out

export default ENDPOINTS;
