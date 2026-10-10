// helpers/groq.js
import fetch from "node-fetch";
import env from "../config/env.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// llama-3.1-8b-instant was decommissioned by Groq (HTTP 404 model_not_found);
// gpt-oss-20b is the supported fast/reasoning-effort-capable replacement.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Constants for layout and styling
const LAYOUT = {
    START_X: 400,
    START_Y: 100,
    NODE_WIDTH: 200,   // column slot width; shapes are centered in the slot
    NODE_HEIGHT: 90,
    MAX_NODE_WIDTH: 280,
    VERTICAL_SPACING: 200, // must exceed the tallest node + channel clearance
    HORIZONTAL_SPACING: 320, // must exceed MAX_NODE_WIDTH so columns never overlap
};

const COLORS = {
    START_END: "#e0e7ff", // indigo-100
    PROCESS: "#ffffff",   // white
    DECISION: "#fff7ed",  // orange-50
    STROKE: "#0f172a",    // slate-900
};

// Right-side gutter offset used for back-edges / multi-level edges so the
// polyline travels outside all node bounds instead of crossing them.
const GUTTER_PAD = 60;
// Extra vertical room below a row for same-level edge dips.
const ROW_DIP = 30;

function nodeBox(node) {
    const left = node.x + (LAYOUT.NODE_WIDTH - node._w) / 2;
    return {
        left,
        right: left + node._w,
        top: node.y,
        bottom: node.y + node._h,
        cx: left + node._w / 2,
        cy: node.y + node._h / 2,
    };
}

/**
 * Route an edge as an orthogonal polyline that never passes through a node:
 * - Adjacent-level forward edge: elbow through the empty band between rows.
 * - Same-level edge: dip below the row.
 * - Back edge or multi-level skip: travel along a right-side gutter clear of
 *   every node, entering the target's right side.
 * Returns absolute [x, y] points.
 */
function routeEdge(source, target, layoutNodes) {
    const s = nodeBox(source);
    const t = nodeBox(target);
    const sLevel = source._level ?? 0;
    const tLevel = target._level ?? 0;

    if (tLevel === sLevel + 1) {
        // Forward edge to the row directly below: exit bottom-center, travel
        // in the gap between the rows, enter top-center.
        const midY = s.bottom + Math.min((t.top - s.bottom) / 2, 40);
        if (Math.abs(s.cx - t.cx) < 1) {
            return [[s.cx, s.bottom], [t.cx, t.top]];
        }
        return [
            [s.cx, s.bottom],
            [s.cx, midY],
            [t.cx, midY],
            [t.cx, t.top],
        ];
    }

    if (tLevel === sLevel) {
        // Same row: exit bottom, dip below the row, enter target bottom.
        const dipY = Math.max(s.bottom, t.bottom) + ROW_DIP;
        return [
            [s.cx, s.bottom],
            [s.cx, dipY],
            [t.cx, dipY],
            [t.cx, t.bottom],
        ];
    }

    // Back edge (upward) or multi-level skip: route around the right gutter.
    const maxRight = Math.max(...layoutNodes.map(n => nodeBox(n).right));
    const gutterX = maxRight + GUTTER_PAD;
    return [
        [s.right, s.cy],
        [gutterX, s.cy],
        [gutterX, t.cy],
        [t.right, t.cy],
    ];
}


/**
 * Deterministic Layout Algorithm
 * Assigns x,y coordinates to nodes based on their connectivity (BFS layers)
 */
function calculateLayout(nodes) {
    if (!nodes || nodes.length === 0) return [];

    // 1. Build Adjacency Map & Find Roots
    const adj = new Map();
    const reverseAdj = new Map();
    const nodeMap = new Map();

    nodes.forEach(node => {
        nodeMap.set(node.id, node);
        adj.set(node.id, node.next || []);
        if (!reverseAdj.has(node.id)) reverseAdj.set(node.id, []);

        (node.next || []).forEach(targetId => {
            if (!reverseAdj.has(targetId)) reverseAdj.set(targetId, []);
            reverseAdj.get(targetId).push(node.id);
        });
    });

    // 2. Identify Levels (BFS)
    // Find nodes with no incoming edges (roots) or default to first
    let roots = nodes.filter(n => (reverseAdj.get(n.id) || []).length === 0);
    if (roots.length === 0) roots = [nodes[0]];

    const levels = [];
    const visited = new Set();
    let queue = roots.map(n => ({ id: n.id, level: 0 }));

    while (queue.length > 0) {
        const { id, level } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);

        if (!levels[level]) levels[level] = [];
        levels[level].push(id);

        const neighbors = adj.get(id) || [];
        neighbors.forEach(nid => {
            queue.push({ id: nid, level: level + 1 });
        });
    }

    const nodeLevel = new Map();
    levels.forEach((levelNodes, levelIndex) => {
        levelNodes.forEach(id => nodeLevel.set(id, levelIndex));
    });

    // 3. Assign Coordinates
    // Center alignment strategy
    const layoutNodes = [];

    levels.forEach((levelNodes, levelIndex) => {
        const levelWidth = levelNodes.length * LAYOUT.HORIZONTAL_SPACING;
        const startX = LAYOUT.START_X - (levelWidth / 2) + (LAYOUT.HORIZONTAL_SPACING / 2);

        levelNodes.forEach((nodeId, idx) => {
            const node = nodeMap.get(nodeId);
            layoutNodes.push({
                ...node,
                x: startX + (idx * LAYOUT.HORIZONTAL_SPACING),
                y: LAYOUT.START_Y + (levelIndex * LAYOUT.VERTICAL_SPACING),
                _level: levelIndex,
            });
        });
    });

    // Add any disconnected nodes at the bottom
    const placedIds = new Set(layoutNodes.map(n => n.id));
    let extraCount = 0;
    nodes.forEach(node => {
        if (!placedIds.has(node.id)) {
            layoutNodes.push({
                ...node,
                x: LAYOUT.START_X,
                y: LAYOUT.START_Y + (levels.length * LAYOUT.VERTICAL_SPACING) + (extraCount * LAYOUT.VERTICAL_SPACING)
            });
            extraCount++;
        }
    });

    return layoutNodes;
}

/**
 * Generates an Excalidraw flowchart using logical structure extraction + deterministic layout
 */
export async function generateExcalidrawFlowchart(prompt, options = {}) {
    if (!prompt) throw new Error("Prompt is required");

    const systemPrompt = `
    You are a technical diagram architect.
    Task: Extract the LOGICAL structure of a flowchart from the user's description.
    Output: A clean JSON object containing a list of nodes and their connections.

    RULES:
    1. 'id': clear, unique string (e.g., "start", "verify_email").
    2. 'type': MUST be one of ["start", "process", "decision", "end"].
         - "start"/"end": Use for entry/exit points (Oval shape).
         - "decision": Use for branching logic (Diamond shape).
         - "process": Use for actions/steps (Rectangle shape).
    3. 'label': Short text to display in the box. MAX 6 words / 40 characters — use a verb-first phrase (e.g., "Score transactions"). NEVER put full sentences or metric dumps in labels.
    4. 'next': Array of IDs that this node connects TO.
    
    EXAMPLE OUTPUT:
    {
      "nodes": [
        { "id": "start", "type": "start", "label": "Start", "next": ["login"] },
        { "id": "login", "type": "process", "label": "User Login", "next": ["check"] },
        { "id": "check", "type": "decision", "label": "Valid?", "next": ["home", "error"] },
        { "id": "home", "type": "process", "label": "Dashboard", "next": ["end"] },
        { "id": "error", "type": "process", "label": "Show Error", "next": ["login"] },
        { "id": "end", "type": "end", "label": "End", "next": [] }
      ]
    }
    
    Return ONLY JSON.
    `;

    try {
        const response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.GROQ_KEY}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Flowchart for: ${prompt} \nComplexity: ${options.complexity || 'standard'}` },
                ],
                temperature: 0.1,
                max_tokens: 4000,
                reasoning_effort: "low",
                response_format: { type: "json_object" },
            }),
        });

        if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("No content received");

        const parsed = JSON.parse(content);
        if (!parsed.nodes || !Array.isArray(parsed.nodes)) throw new Error("Invalid nodes array");

        // 1. Calculate Positions
        const layoutNodes = calculateLayout(parsed.nodes);

        // 2. Pre-compute every node's size so edge routing knows all bounds
        layoutNodes.forEach(node => {
            const label = String(node.label || "");
            const isDecision = node.type === "decision";
            const isTerminal = node.type === "start" || node.type === "end";

            const nodeWidth = Math.min(
                LAYOUT.MAX_NODE_WIDTH,
                Math.max(LAYOUT.NODE_WIDTH, 130 + label.length * 5),
            );
            const estLines = Math.max(1, Math.ceil(label.length / Math.max(1, (nodeWidth - 30) / 8)));
            let nodeHeight = Math.max(LAYOUT.NODE_HEIGHT, 46 + estLines * 22);
            if (isDecision) nodeHeight = Math.max(110, nodeWidth * 0.45);
            if (isTerminal) nodeHeight = Math.max(80, nodeHeight * 0.8);
            node._w = nodeWidth;
            node._h = nodeHeight;
        });

        // 3. Convert to Excalidraw Elements
        const elements = [];

        layoutNodes.forEach(node => {
            // -- SHAPE --
            const shapeId = node.id;
            const textId = `${node.id}-text`;
            const label = String(node.label || "");

            let excalidrawType = "rectangle";
            let bgColor = COLORS.PROCESS;
            let roundness = { type: 3 };

            if (node.type === "decision") {
                excalidrawType = "diamond";
                bgColor = COLORS.DECISION;
            } else if (node.type === "start" || node.type === "end") {
                excalidrawType = "ellipse";
                bgColor = COLORS.START_END;
            }

            const nodeWidth = node._w;
            const nodeHeight = node._h;

            // Common defaults for all elements
            const commonProps = {
                version: 1,
                versionNonce: 0,
                isDeleted: false,
                groupIds: [],
                frameId: null,
                boundElements: [],
                updated: Date.now(),
                link: null,
                locked: false,
                opacity: 100,
                strokeColor: COLORS.STROKE,
                strokeStyle: "solid",
                strokeWidth: 2.5,
                fillStyle: "solid",
                roughness: 0,
                seed: Math.floor(Math.random() * 100000),
            };

            // Push Shape (center horizontally in its slot since widths now vary)
            elements.push({
                ...commonProps,
                id: shapeId,
                type: excalidrawType,
                x: node.x + (LAYOUT.NODE_WIDTH - nodeWidth) / 2,
                y: node.y,
                width: nodeWidth,
                height: nodeHeight,
                backgroundColor: bgColor,
                roundness: roundness,
                boundElements: [{ id: textId, type: "text" }], // Bind text to shape
            });

            // Push Text (fills the container so Excalidraw wraps it)
            elements.push({
                ...commonProps,
                id: textId,
                type: "text",
                x: node.x + (LAYOUT.NODE_WIDTH - nodeWidth) / 2 + 10,
                y: node.y + 10,
                width: nodeWidth - 20,
                height: nodeHeight - 20,
                text: label,
                fontSize: 15,
                fontFamily: 1,
                textAlign: "center",
                verticalAlign: "middle",
                containerId: shapeId, // CRITICAL: This auto-centers the text in Excalidraw
                originalText: node.label || "",
                backgroundColor: "transparent",
                strokeWidth: 1,
                roughness: 0,
            });

            // Push Arrows (Edges) — orthogonal polylines routed through the
            // empty bands between rows / the side gutter so they never cross
            // a node body.
            if (node.next && Array.isArray(node.next)) {
                node.next.forEach((targetId) => {
                    const targetNode = layoutNodes.find(n => n.id === targetId);
                    if (!targetNode || targetId === node.id) return;

                    const pts = routeEdge(node, targetNode, layoutNodes);
                    const xs = pts.map(p => p[0]);
                    const ys = pts.map(p => p[1]);
                    const minX = Math.min(...xs);
                    const minY = Math.min(...ys);
                    const maxX = Math.max(...xs);
                    const maxY = Math.max(...ys);

                    elements.push({
                        ...commonProps,
                        id: `${node.id}-to-${targetId}`,
                        type: "arrow",
                        x: minX,
                        y: minY,
                        width: Math.max(maxX - minX, 1),
                        height: Math.max(maxY - minY, 1),
                        backgroundColor: "transparent",
                        roundness: { type: 2 },
                        boundElements: [],
                        points: pts.map(([px, py]) => [px - minX, py - minY]),
                        startBinding: null,
                        endBinding: null,
                        endArrowhead: "arrow",
                    });
                });
            }
        });

        return {
            type: "excalidraw",
            version: 2,
            source: "https://excalidraw.com",
            elements: elements,
            appState: { viewBackgroundColor: "#f8fafc", gridSize: null },
            files: {}
        };

    } catch (error) {
        console.error("Layout generation failed:", error);
        throw error;
    }
}

/**
 * Generates a textual flowchart description using Groq
 * @param {string} prompt - Process or system to describe
 * @returns {Promise<string>} - Flowchart description
 */
export async function generateFlowchartDescription(prompt) {
    if (!prompt || typeof prompt !== "string") {
        throw new Error("Prompt must be a non-empty string");
    }

    if (!env.GROQ_KEY) {
        throw new Error("GROQ_KEY environment variable is not set");
    }

    let response;
    try {
        response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.GROQ_KEY}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    {
                        role: "system",
                        content: `You are an expert at breaking down complex processes into clear, logical flowcharts.

Analyze the process and provide:
1. Key decision points
2. Sequential steps
3. Alternative paths
4. Start and end conditions
5. Error handling flows

Format your response in a structured way suitable for flowchart visualization.`,
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.6,
                max_tokens: 3000,
            }),
        });
    } catch (error) {
        throw new Error(`Network error calling Groq API: ${error.message}`);
    }

    if (!response.ok) {
        const status = response.status;
        let errorText = "";
        try {
            errorText = await response.text();
        } catch {
            // Ignore
        }
        throw new Error(`Groq API error ${status}${errorText ? `: ${errorText}` : ""}`);
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error(`Failed to parse Groq API response: ${error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error("Empty response from Groq API");
    }

    return content.trim();
}

/**
 * Health check for Groq API
 * @returns {Promise<boolean>} - True if API is accessible
 */
export async function checkGroqHealth() {
    try {
        const response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.GROQ_KEY}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: "user", content: "test" }],
                max_tokens: 4096,
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export default {
    generateExcalidrawFlowchart,
    generateFlowchartDescription,
    checkGroqHealth,
    LAYOUT,
    COLORS,
};