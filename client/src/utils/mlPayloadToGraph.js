/**
 * Converts ML schema payload (P1–P6) into graph format: { nodes, links, graph } for visualization.
 * Nodes: { id, label, group, size, tooltip }; Links: { source, target, label, strength, weight }.
 */

function node(id, label, group = "default", size = 8, tooltip = "") {
  return { id: String(id), label: String(label || id), group, size, tooltip: String(tooltip || "") };
}

function link(source, target, label = "", weight = 1) {
  const w = typeof weight === "number" && weight > 0 ? weight : 1;
  return { source: String(source), target: String(target), label: String(label), strength: 0.5, weight: w };
}

function getLabel(obj, fallback) {
  if (!obj) return fallback;
  if (obj.display_label && typeof obj.display_label === "string") return obj.display_label.trim() || fallback;
  return fallback;
}

function getTooltip(obj) {
  if (!obj || typeof obj.description !== "string") return "";
  return obj.description.trim();
}

function addNodesFromArray(nodes, arr, group, labelKey = "id", sizeByShell = true) {
  if (!Array.isArray(arr)) return;
  arr.forEach((e) => {
    if (!e || !e.id) return;
    const grp = e.is_shell ? "shell" : group;
    const sz = sizeByShell && e.is_shell === true ? 6 : (e.size ?? 10);
    const lbl = getLabel(e, e[labelKey] || e.id);
    const tip = getTooltip(e);
    nodes.push(node(e.id, lbl, grp, sz, tip));
  });
}

function addNodeFromObj(nodes, obj, group, labelKey = "id") {
  if (!obj || !obj.id) return;
  const lbl = getLabel(obj, obj[labelKey] || obj.id);
  const tip = getTooltip(obj);
  nodes.push(node(obj.id, lbl, group, 10, tip));
}

/**
 * @param {object} payload - ML generate payload (sample_id, entities, transactions/invoices, features, graph)
 * @returns {{ nodes: Array<{id, label, group, size, tooltip}>, links: Array<{source, target, label, strength, weight}>, graph: { title?, subtitle? } }}
 */
export function mlPayloadToGraph(payload) {
  const nodes = [];
  const links = [];
  let graphMeta = { title: "", subtitle: "" };
  if (!payload || typeof payload !== "object") return { nodes, links, graph: graphMeta };

  // Universal graph shape support (payload.graph + nodes + edges)
  const universal = payload.payload && typeof payload.payload === "object" ? payload.payload : payload;
  if (Array.isArray(universal.nodes) && Array.isArray(universal.edges)) {
    const graphPayload = universal.graph && typeof universal.graph === "object" ? universal.graph : {};
    graphMeta = {
      title: typeof graphPayload.title === "string" ? graphPayload.title.trim() : "",
      subtitle: typeof graphPayload.subtitle === "string" ? graphPayload.subtitle.trim() : "",
    };

    universal.nodes.forEach((n) => {
      if (!n || !n.id) return;
      const label = n.label || n.display_label || n.id;
      const group = n.type || "default";
      const tooltip = typeof n.description === "string" ? n.description : "";
      const size = typeof n.size === "number" ? n.size : (Array.isArray(n.tags) && n.tags.includes("shell") ? 6 : 10);
      nodes.push(node(n.id, label, group, size, tooltip));
    });

    universal.edges.forEach((e) => {
      if (!e) return;
      const source = e.from || e.source;
      const target = e.to || e.target;
      if (!source || !target) return;
      const label = e.label || e.edge_label || [e.type, e.amount?.value != null ? `${e.amount.value} ${e.amount.unit || ""}`.trim() : "", e.date || ""].filter(Boolean).join(" ");
      const weight = typeof e.weight === "number" ? e.weight : (e.amount?.value ? Math.min(3, 0.5 + e.amount.value / 10) : 1);
      links.push(link(source, target, label, weight));
    });

    return { nodes, links, graph: graphMeta };
  }

  const entities = payload.entities || {};
  const graphPayload = payload.graph && typeof payload.graph === "object" ? payload.graph : {};
  graphMeta = {
    title: typeof graphPayload.title === "string" ? graphPayload.title.trim() : "",
    subtitle: typeof graphPayload.subtitle === "string" ? graphPayload.subtitle.trim() : "",
  };

  function edgeLabel(t, fallback) {
    if (t && typeof t.edge_label === "string" && t.edge_label.trim()) return t.edge_label.trim();
    return fallback;
  }

  function edgeWeight(t) {
    if (t && typeof t.amount_cr === "number" && t.amount_cr > 0) return Math.min(3, 0.5 + t.amount_cr / 10);
    if (t && typeof t.declared_value_lakhs === "number") return Math.min(3, 0.5 + t.declared_value_lakhs / 200);
    return 1;
  }

  // P1 — Round Trip: companies + transactions (from/to)
  if (entities.companies && Array.isArray(entities.companies)) {
    entities.companies.forEach((c) => {
      const grp = c.is_shell ? "shell" : "company";
      const lbl = getLabel(c, `${c.id} (${c.jurisdiction || "?"})`);
      const tip = getTooltip(c);
      nodes.push(node(c.id, lbl, grp, c.is_shell ? 6 : 10, tip));
    });
    (payload.transactions || []).forEach((t) => {
      if (t.from && t.to) {
        const lbl = edgeLabel(t, [t.type, t.amount_cr != null ? `${t.amount_cr} cr` : "", t.date || ""].filter(Boolean).join(" ") || "TRANSFER");
        links.push(link(t.from, t.to, lbl, edgeWeight(t)));
      }
    });
    return { nodes, links, graph: graphMeta };
  }

  // P2 — Loan Evergreening: borrower, shells, bank_accounts + transactions
  if (entities.borrower || (entities.shells && entities.shells.length) || (entities.bank_accounts && entities.bank_accounts.length)) {
    if (entities.borrower) addNodeFromObj(nodes, entities.borrower, "borrower", "id");
    addNodesFromArray(nodes, entities.shells, "shell");
    addNodesFromArray(nodes, entities.bank_accounts, "bank", "bank", false);
    (payload.transactions || []).forEach((t) => {
      const fromId = t.from_entity_id || t.from_bank;
      const toId = t.to_entity_id || t.to_bank;
      if (fromId && toId) {
        const lbl = edgeLabel(t, [t.type, t.amount_cr != null ? `${t.amount_cr} cr` : ""].filter(Boolean).join(" ") || "LOAN");
        links.push(link(fromId, toId, lbl, edgeWeight(t)));
      }
    });
    return { nodes, links, graph: graphMeta };
  }

  // P3 — Invoice Fraud: indian_entity, foreign_entity + invoices
  if (entities.indian_entity || entities.foreign_entity) {
    if (entities.indian_entity) addNodeFromObj(nodes, entities.indian_entity, "company");
    if (entities.foreign_entity) addNodeFromObj(nodes, entities.foreign_entity, "shell");
    (payload.invoices || []).forEach((inv) => {
      if (inv.from_entity && inv.to_entity) {
        const lbl = edgeLabel(inv, inv.declared_value_lakhs != null ? `${inv.declared_value_lakhs}L` : "INV");
        links.push(link(inv.from_entity, inv.to_entity, lbl, edgeWeight(inv)));
      }
    });
    return { nodes, links, graph: graphMeta };
  }

  // P4 — Hawala: person, bank_account + transactions
  if (entities.person || entities.bank_account) {
    if (entities.person) addNodeFromObj(nodes, entities.person, "person");
    if (entities.bank_account) addNodeFromObj(nodes, entities.bank_account, "bank", "bank");
    const personId = entities.person?.id;
    const bankId = entities.bank_account?.id;
    (payload.transactions || []).forEach((t) => {
      if (personId && bankId) {
        const lbl = edgeLabel(t, [t.type, t.amount_cr != null ? `${t.amount_cr} cr` : ""].filter(Boolean).join(" ") || t.type || "TX");
        links.push(link(personId, bankId, lbl, edgeWeight(t)));
      }
    });
    return { nodes, links, graph: graphMeta };
  }

  // P5 — Benami: real_owner, nominees, properties, shells
  if (entities.real_owner || (entities.nominees && entities.nominees.length) || (entities.properties && entities.properties.length) || (entities.shells && entities.shells.length)) {
    if (entities.real_owner) addNodeFromObj(nodes, entities.real_owner, "person");
    addNodesFromArray(nodes, entities.nominees, "person", "id", false);
    addNodesFromArray(nodes, entities.shells, "shell", "id", true);
    (entities.properties || []).forEach((p) => {
      const lbl = getLabel(p, `Prop ${p.value_cr != null ? p.value_cr + " cr" : p.id}`);
      const tip = getTooltip(p);
      if (p.id) nodes.push(node(p.id, lbl, "property", 6, tip));
      if (p.registered_owner_id && p.actual_owner_id) links.push(link(p.registered_owner_id, p.actual_owner_id, "benami", 1.2));
      if (p.id && p.registered_owner_id) links.push(link(p.registered_owner_id, p.id, "registered", 1));
    });
    (entities.shells || []).forEach((s) => {
      if (s.director_id && s.beneficial_owner_id) links.push(link(s.director_id, s.beneficial_owner_id, "controls", 1.2));
    });
    return { nodes, links, graph: graphMeta };
  }

  // P6 — PEP Kickback: pep, contractor, shell, government_entity + transactions
  if (entities.pep || entities.contractor || entities.shell || entities.government_entity) {
    if (entities.pep) addNodeFromObj(nodes, entities.pep, "person");
    if (entities.contractor) addNodeFromObj(nodes, entities.contractor, "company");
    if (entities.shell) addNodeFromObj(nodes, entities.shell, "shell");
    if (entities.government_entity) addNodeFromObj(nodes, entities.government_entity, "government");
    (payload.transactions || []).forEach((t) => {
      if (t.from && t.to) {
        const lbl = edgeLabel(t, [t.type, t.amount_cr != null ? `${t.amount_cr} cr` : ""].filter(Boolean).join(" ") || "TRANSFER");
        links.push(link(t.from, t.to, lbl, edgeWeight(t)));
      }
    });
    return { nodes, links, graph: graphMeta };
  }

  return { nodes, links, graph: graphMeta };
}

export default mlPayloadToGraph;
