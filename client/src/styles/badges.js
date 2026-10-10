/**
 * badges.js
 *
 * Shared badge and status styles for consistent UX across the platform.
 * Used by alerts, cases, actions, and analysis results.
 */

// Severity badge styles
export const SEVERITY_STYLES = {
  critical: {
    badge: 'bg-destructive/10 text-destructive border-destructive/30',
    dot: 'bg-destructive',
    text: 'text-destructive',
  },
  high: {
    badge: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    dot: 'bg-orange-500',
    text: 'text-orange-500',
  },
  medium: {
    badge: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
    dot: 'bg-yellow-500',
    text: 'text-yellow-600',
  },
  low: {
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600',
  },
};

// Alert status styles
export const ALERT_STATUS_STYLES = {
  open: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  investigating: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  resolved: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  dismissed: 'bg-muted text-muted-foreground border-border',
};

// Case status styles
export const CASE_STATUS_STYLES = {
  new: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  triaging: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  investigating: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  escalated: 'bg-red-500/10 text-red-500 border-red-500/30',
  monitoring: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
  mitigated: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  closed: 'bg-muted text-muted-foreground border-border',
};

// Priority styles
export const PRIORITY_STYLES = {
  critical: 'bg-destructive/10 text-destructive border-destructive/30',
  high: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  low: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
};

// Action status styles
export const ACTION_STATUS_STYLES = {
  suggested: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  approved: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
  in_progress: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
  completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  failed: 'bg-red-500/10 text-red-500 border-red-500/30',
  dismissed: 'bg-muted text-muted-foreground border-border',
};

// Threat family display labels
export const THREAT_FAMILY_LABELS = {
  phishing: 'Phishing',
  impersonation: 'Impersonation',
  malicious_url: 'Malicious URL',
  malicious_attachment: 'Malicious Attachment',
  social_engineering_scam: 'Social Engineering',
  misinformation: 'Misinformation',
  aml_financial_threat: 'AML / Financial',
  unknown: 'Unknown',
};

// Helper to get severity style
export function getSeverityStyle(severity) {
  return SEVERITY_STYLES[severity] || SEVERITY_STYLES.medium;
}

// Helper to get alert status style
export function getAlertStatusStyle(status) {
  return ALERT_STATUS_STYLES[status] || ALERT_STATUS_STYLES.open;
}

// Helper to get case status style
export function getCaseStatusStyle(status) {
  return CASE_STATUS_STYLES[status] || CASE_STATUS_STYLES.new;
}

// Helper to get priority style
export function getPriorityStyle(priority) {
  return PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
}

// Helper to get action status style
export function getActionStatusStyle(status) {
  return ACTION_STATUS_STYLES[status] || ACTION_STATUS_STYLES.suggested;
}

// Helper to get threat family label
export function getThreatFamilyLabel(family) {
  return THREAT_FAMILY_LABELS[family] || family?.replace(/_/g, ' ') || 'Unknown';
}

// Time ago helper (shared across components)
export function timeAgo(isoString) {
  if (!isoString) return 'Unknown';
  try {
    const ms = Date.now() - new Date(isoString).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(isoString).toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

export default {
  SEVERITY_STYLES,
  ALERT_STATUS_STYLES,
  CASE_STATUS_STYLES,
  PRIORITY_STYLES,
  ACTION_STATUS_STYLES,
  THREAT_FAMILY_LABELS,
  getSeverityStyle,
  getAlertStatusStyle,
  getCaseStatusStyle,
  getPriorityStyle,
  getActionStatusStyle,
  getThreatFamilyLabel,
  timeAgo,
};
