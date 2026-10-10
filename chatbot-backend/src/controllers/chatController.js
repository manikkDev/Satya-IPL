// src/controllers/chatController.js
import fetch from "node-fetch";
import xlsx from "xlsx";
import {
  generateContent,
  buildRequestBody,
  MODEL_ID,
  BASE_URL,
  extractTextFromUploads,
  extractImagesFromUploads,
} from "../helpers/gemini.js";
import { searchImages } from "../helpers/imageSearch.js";
import { buildAmlAssistantPrompt } from "../prompts/FinancialAI.js";
import { buildCopilotPrompt } from "../prompts/copilotPrompt.js";
import { buildRiskContext } from "../helpers/riskContext.js";
import { conversations } from "../helpers/conversationStore.js";
import { detectIntents, deterministicFallback, formatToolContext, runTools } from "../helpers/copilotTools.js";
import { resolveAuthorizedInvestigationMode } from "../helpers/riskMode.js";
import YouTubeMCP from "../helpers/youtubeSearch.js";
import env from "../config/env.js";
import { processMermaidBlocks } from "../helpers/mermaid.js";
import { runFeatherlessChat } from "../helpers/featherless.js";
import { generateMlSchema } from "../helpers/mlSchemaGenerator.js";
import { classifyAmlSample } from "../helpers/amlClassifier.js";
import {
  searchSocialProfiles,
  isSocialSearchEnabled,
} from "../helpers/socialSearch.js";

const FEATHERLESS_MODEL = env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-32B-Instruct";

// Initialize YouTube MCP
const youtubeMCP = env.YOUTUBE_API_KEY
  ? new YouTubeMCP(env.YOUTUBE_API_KEY)
  : null;
if (!youtubeMCP) {
  console.warn(
    "⚠️  YouTube API key not configured - YouTube search will be disabled",
  );
}

const STREAM_FINISH_DEBOUNCE_MS = 80;
const STREAM_CLOSE_DELAY_MS = 60;
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_TRANSACTION_ROWS = 200;
const MAX_TRANSACTION_CONTEXT_CHARS = 20000;

function shouldIncludeSocial(prompt, options = {}) {
  if (typeof options.includeSocial === "boolean") return options.includeSocial;
  const text = String(prompt || "").trim();
  return text.length > 0;
}

function isExcelLikeFile(file) {
  if (!file) return false;
  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();
  return (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".csv")
  );
}

function parseExcelToJson(file) {
  try {
    const workbook = xlsx.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: null });
  } catch (error) {
    console.warn(
      "[transactions] Failed to parse excel:",
      error?.message || error,
    );
    try {
      const rawText = Buffer.from(file.buffer || "").toString("utf8");
      const text = rawText.replace(/\r\n/g, "\n").trim();
      if (!text) return [];
      const firstLine = text.split("\n")[0] || "";
      const delimiter = firstLine.includes("\t")
        ? "\t"
        : firstLine.includes(";")
          ? ";"
          : ",";

      const rows = parseDelimitedTextToObjects(text, delimiter);
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }
}

function parseDelimitedTextToObjects(text, delimiter) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === delimiter && !inQuotes) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]).map((h, i) =>
    h ? h.replace(/\s+/g, "_").toLowerCase() : `col_${i + 1}`,
  );
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseLine(lines[i]);
    if (values.every((v) => v === "")) continue;
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j] ?? null;
    }
    rows.push(row);
  }
  return rows;
}

function extractJsonPayload(text = "") {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const firstBrace = candidate.indexOf("{");
  const firstBracket = candidate.indexOf("[");
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (start === -1) return null;
  const endBrace = candidate.lastIndexOf("}");
  const endBracket = candidate.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (end === -1) return null;
  return candidate.slice(start, end + 1);
}

function tryParseJsonWithRepairs(rawText = "") {
  const extracted = extractJsonPayload(rawText);
  if (!extracted) return null;
  const candidates = [extracted, extracted.replace(/,\s*([}\]])/g, "$1")];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

async function structureTransactionsWithOpenAI(rawRows) {
  if (!env.FEATHERLESS_API_KEY) {
    return {
      transactions: rawRows,
      summary: {
        row_count: rawRows.length,
        note: "Featherless API key not set; using raw rows.",
      },
    };
  }

  // Send raw JSON rows (unstructured) to the LLM first
  const payload = JSON.stringify(rawRows, null, 2);
  const system =
    "You are a data normalization engine. Convert raw transaction rows into strict JSON. " +
    'Output ONLY JSON with schema: { "transactions": [ ... ], "summary": { "row_count": number, "notes": string } }. ' +
    "Normalize keys to snake_case and keep values as strings or numbers.";
  let content = "";
  try {
    const outputs = await runFeatherlessChat({
      system,
      user: `Raw transaction rows:\n${payload}`,
      model: FEATHERLESS_MODEL,
      maxTokens: 2048,
    });
    content = outputs?.[0] || "";
  } catch (error) {
    console.warn(
      "[transactions] Featherless call failed:",
      error?.message || error,
    );
  }
  const parsed = tryParseJsonWithRepairs(content);
  if (!parsed) {
    return {
      transactions: rawRows,
      summary: {
        row_count: rawRows.length,
        note: "Failed to parse OpenAI output; using raw rows.",
      },
    };
  }

  return parsed;
}

function keepTransactionsUnscored(structured) {
  return structured;
}

async function buildTransactionContextFromUploads(files = []) {
  const excelFiles = files.filter(isExcelLikeFile);
  if (!excelFiles.length) return null;

  const rows = excelFiles
    .flatMap(parseExcelToJson)
    .slice(0, MAX_TRANSACTION_ROWS);
  if (!rows.length) return null;

  const structured = await structureTransactionsWithOpenAI(rows);
  const unscored = keepTransactionsUnscored(structured);
  let contextText = JSON.stringify(unscored, null, 2);

  if (contextText.length > MAX_TRANSACTION_CONTEXT_CHARS) {
    contextText = contextText.slice(0, MAX_TRANSACTION_CONTEXT_CHARS);
  }

  return {
    rawRows: rows,
    contextText,
    rowCount: rows.length,
    structured,
    unscored,
  };
}

/**
 * Fetch page title from URL with timeout
 * @param {string} url - The URL to fetch title from
 * @returns {Promise<string>} - The page title or fallback
 */
async function fetchPageTitle(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : "";

    if (title) {
      title = title.replace(/\s+/g, " ").trim();
      if (title.length > 100) {
        title = title.substring(0, 97) + "...";
      }
    }

    if (!title) {
      const urlObj = new URL(url);
      title = urlObj.hostname.replace(/^www\./, "");
    }

    return title;
  } catch (error) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "");
    } catch (e) {
      return "Link";
    }
  }
}

function buildContextualSearchQuery({
  prompt,
  history,
  extra,
  maxLength = 200,
}) {
  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const extraText = typeof extra === "string" ? extra.trim() : "";
  const userSnippets = [];
  const assistantSnippets = [];
  if (Array.isArray(history) && history.length) {
    const chronological = [...history].reverse();
    for (let i = chronological.length - 1; i >= 0; i -= 1) {
      const message = chronological[i];
      const text =
        typeof message?.content === "string" ? message.content.trim() : "";
      if (!text) {
        continue;
      }
      if (message.role === "user" && userSnippets.length < 2) {
        userSnippets.push(text);
      } else if (message.role === "model" && assistantSnippets.length < 1) {
        assistantSnippets.push(text);
      }
      if (userSnippets.length >= 2 && assistantSnippets.length >= 1) {
        break;
      }
    }
  }
  const segments = [];
  segments.push(...userSnippets.reverse(), ...assistantSnippets.reverse());
  if (extraText) {
    segments.push(extraText);
  }
  if (trimmedPrompt) {
    segments.push(trimmedPrompt);
  }
  const normalized = segments
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!normalized.length) {
    return "";
  }
  const combined = normalized.join(" | ");
  return combined.length > maxLength ? combined.slice(0, maxLength) : combined;
}

/**
 * Search YouTube videos using MCP
 * @param {string} query - Search query
 * @param {string} userId - User ID for rate limiting
 * @returns {Promise<Array>} - Array of video results
 */
async function searchYouTubeVideos(query, userId) {
  if (!youtubeMCP) {
    console.log(
      "[YouTube MCP] YouTube search disabled - no API key configured",
    );
    return [];
  }

  try {
    console.log("[YouTube MCP] Searching for:", query);
    const result = await youtubeMCP.search({
      query,
      maxResults: 5,
      order: "relevance",
      userId,
    });

    if (result.success && result.results) {
      console.log(`[YouTube MCP] Found ${result.results.length} videos`);
      return result.results;
    }

    return [];
  } catch (error) {
    console.error("[YouTube MCP] Search failed:", error.message);
    // Don't fail the entire request if YouTube search fails
    return [];
  }
}

// Generate chat response and store in conversation
export async function handleChatGenerate(req, res) {
  try {
    const start = Date.now();
    // For multipart/form-data, fields come as strings; parse options safely
    const { prompt, conversationId } = req.body || {};
    let { options } = req.body || {};
    if (options && typeof options === "string") {
      try {
        options = JSON.parse(options);
      } catch {
        options = {};
      }
    }
    options = options || {};

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const investigationMode = resolveAuthorizedInvestigationMode(options.investigationMode || options.mode, req.user);
    if (!investigationMode) {
      return res.status(403).json({ error: "This copilot mode is not available for your role" });
    }
    const isRiskMode = investigationMode === "risk_analyst" || investigationMode === "risk_citizen";

    // userId is set by optionalAuth middleware
    const userId = req.userId;
    let currentConversationId = conversationId;

    // After getting the userId from req.userId
    const userData = await conversations.profile(req).catch(() => null);

    if (!userData) {
      console.error("Error fetching user data from the application identity service");
      // Handle error or continue without username
    }

    const username = userData?.name || userData?.email || "User";
    const userEmail = userData?.email || "";

    console.log("[handleChatGenerate] User info:", {
      userId,
      username,
      userEmail,
    });

    // If no conversation ID provided, create a new conversation
    if (!currentConversationId) {
      const conversation = await conversations.create(
        req,
        prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
      );

      if (!conversation?.id) {
        // Mongo identities own conversations in the authoritative application store.
        // A chat request fails closed if durable ownership cannot be established.
        throw new Error("Conversation persistence is unavailable");
      } else {
        currentConversationId = conversation.id;
      }
    }

    // Get last 10 messages for context
    const conversationHistory = await conversations.get(req, currentConversationId);
    const messages = (conversationHistory.messages || []).slice(-10).reverse();

    if (!Array.isArray(messages)) {
      console.error("Error fetching history from the application conversation store");
      return res
        .status(500)
        .json({ error: "Failed to fetch conversation history" });
    }

    // Reverse to get chronological order
    const chatHistory = messages
      ? [...messages].reverse().map((m) => ({
          role: m.role,
          parts: [{ text: m.content }],
        }))
      : [];

    const uploads = Array.isArray(req.files) ? req.files : [];
    const transactionContext =
      await buildTransactionContextFromUploads(uploads);

    // Risk modes: detect + execute authorized tools first so the model composes
    // its answer over labeled evidence rather than improvising numbers.
    const toolResults = isRiskMode
      ? await runTools(req, detectIntents(prompt, investigationMode))
      : [];
    const toolContext = formatToolContext(toolResults);

    const modelPrompt = [
      prompt,
      transactionContext
        ? `--- Structured Transactions (unscored; do not infer a model score) ---\n${transactionContext.contextText}`
        : "",
      toolContext,
    ].filter(Boolean).join("\n\n");

    // Add current user message to history
    chatHistory.push({
      role: "user",
      parts: [{ text: modelPrompt }],
    });

    // Determine includeSearch: default true (enable web search even with files)
    const effectiveIncludeSearch = isRiskMode
      ? false
      : typeof options.includeSearch === "boolean" ? options.includeSearch : true;
    const analysisContext = isRiskMode
      ? await buildRiskContext(req, investigationMode).catch(() => null)
      : options.analysisContext || null;
    const systemPrompt = buildCopilotPrompt(investigationMode, username, analysisContext);

    // Generate AI response — degrade to deterministic tool output in risk modes
    // if the provider fails, so numeric claims are never fabricated.
    let response;
    try {
      response = await generateContent(modelPrompt, userId, {
        history: chatHistory.slice(-10), // Only keep last 10 messages for context
        includeSearch: effectiveIncludeSearch,
        uploads,
        username,
        systemPrompt,
        // Reset history when new files arrive unless explicitly kept
        resetHistory: uploads.length > 0 && options.keepHistoryWithFiles !== true,
      });
    } catch (llmError) {
      if (!isRiskMode) throw llmError;
      console.warn("[copilot] LLM call failed, using deterministic fallback:", llmError?.message);
      response = null;
    }
    // generateContent resolves with an error payload instead of throwing, so
    // detect that here as well — risk modes must show tool evidence, not a raw error.
    if (isRiskMode && response?.error) {
      console.warn("[copilot] LLM response degraded:", response.error);
      response = null;
    }

    const processingTime = Date.now() - start;
    const includeImageSearch = !isRiskMode && options.includeImageSearch !== false;
    const contextualImageQuery = buildContextualSearchQuery({
      prompt,
      history: messages,
    });
    const imageResults =
      includeImageSearch && contextualImageQuery
        ? await searchImages(contextualImageQuery)
        : [];

    const aiContent = response?.content || response?.text || "";
    const aiSources = Array.isArray(response?.sources) ? response.sources : [];
    const aiCodeSnippets = Array.isArray(response?.codeSnippets)
      ? response.codeSnippets
      : [];
    const aiExecutionOutputs = Array.isArray(response?.executionOutputs)
      ? response.executionOutputs
      : [];
    const aiExcalidrawData = Array.isArray(response?.excalidrawData)
      ? response.excalidrawData
      : null;

    // If content is empty but we have excalidrawData, add a default message
    let finalContent = aiContent;
    if (!finalContent && aiExcalidrawData && aiExcalidrawData.length > 0) {
      finalContent =
        "I've created a flowchart for you. You can view, download, or expand it below.";
    }
    if (isRiskMode && !finalContent) {
      finalContent = deterministicFallback(toolResults, investigationMode);
    }

    let socialPayload = null;
    if (!isRiskMode && shouldIncludeSocial(prompt, options)) {
      console.log("[socialSearch] running (non-stream) for prompt:", prompt);
      const socialResults = await searchSocialProfiles(prompt, {
        location: options.location,
      });
      const reason = socialResults?.some((r) => r?.results?.length)
        ? ""
        : isSocialSearchEnabled()
          ? "No public profiles found."
          : "Social search disabled: missing GOOGLE_API_KEY or GOOGLE_CSE_ID.";
      socialPayload = { socials: socialResults || [], reason };
    }

    const saveResult = await conversations.append(req, currentConversationId, [
      {
        role: "user",
        content: prompt,
        sources: [],
        images: [],
      },
      {
        role: "model",
        content: finalContent,
        sources: aiSources,
        images: imageResults.length > 0 ? imageResults : [],
        excalidraw: aiExcalidrawData || [], // Store in new column
      },
    ]);

    if (!saveResult?.ok) {
      console.error("Error saving messages to the application conversation store");
      // Don't fail the request, just log the error
    }

    // Conversation append updates the authoritative updated_at timestamp.

    const apiResponse = {
      content: finalContent,
      sources: aiSources,
      images: imageResults,
      codeSnippets: aiCodeSnippets,
      executionOutputs: aiExecutionOutputs,
      excalidrawData: aiExcalidrawData, // Include in API response
      socialProfiles: socialPayload?.socials || [],
      socialReason: socialPayload?.reason || "",
      timestamp: new Date().toISOString(),
      processingTime,
      attempts: response?.attempts || 1,
      conversationId: currentConversationId,
      mode: investigationMode,
      evidence: toolResults.map((r) => ({ tool: r.tool, label: r.label, ok: r.ok, evidence_id: r.evidence_id, summary: r.summary })),
      llm_degraded: isRiskMode && !response,
    };

    res.json(apiResponse);
  } catch (error) {
    console.error("Error in handleChatGenerate:", error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
}

// Stream chat response with database persistence
export async function handleChatStreamGenerate(req, res) {
  try {
    const { prompt: rawPrompt, conversationId } = req.body || {};
    // Parse options (may be JSON string for multipart)
    let { options: rawOptions } = req.body || {};
    if (rawOptions && typeof rawOptions === "string") {
      try {
        rawOptions = JSON.parse(rawOptions);
      } catch {
        rawOptions = {};
      }
    }
    const options =
      typeof rawOptions === "object" && rawOptions !== null ? rawOptions : {};
    const prompt = String(rawPrompt || "").trim();

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const investigationMode = resolveAuthorizedInvestigationMode(options.investigationMode || options.mode, req.user);
    if (!investigationMode) {
      return res.status(403).json({ error: "This copilot mode is not available for your role" });
    }
    const isRiskMode = investigationMode === "risk_analyst" || investigationMode === "risk_citizen";

    const userId = req.userId;
    let currentConversationId = conversationId;
    let streamedContent = "";
    const streamedSources = new Set();
    let finalSourcesWithTitles = []; // Store final sources to save to DB
    let streamedExcalidrawData = []; // Capture generated charts
    let streamedGraphData = null; // Neo4j mini-graph payload for the chat
    const executedFunctionCalls = []; // name/args/result for the follow-up turn
    let streamComplete = false; // Track if we received finishReason: "STOP" or "MAX_TOKENS"
    let lastFinishReason = null; // Store the finish reason for validation

    // After getting the userId from req.userId
    const userData = await conversations.profile(req).catch(() => null);

    if (!userData) {
      console.error("Error fetching user data from the application identity service");
      // Handle error or continue without username
    }

    const username = userData?.name || userData?.email || "User";
    const userEmail = userData?.email || "";

    console.log("[handleChatStreamGenerate] User info:", {
      userId,
      username,
      userEmail,
    });

    // If no conversation ID provided, create a new conversation
    if (!currentConversationId) {
      const conversation = await conversations.create(
        req,
        prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
      );

      if (!conversation?.id) {
        // Mongo identities own conversations in the authoritative application store.
        // A stream fails closed if durable ownership cannot be established.
        throw new Error("Conversation persistence is unavailable");
      } else {
        currentConversationId = conversation.id;
      }
    }

    // Get conversation history for context (if we are not resetting due to file uploads)
    const files = Array.isArray(req.files) ? req.files : [];
    const keepHistory =
      options.keepHistoryWithFiles === true || files.length === 0;

    let messages = [];
    if (keepHistory) {
      const history = await conversations.get(req, currentConversationId);
      const historyMessages = (history.messages || []).slice(-10).reverse();

      if (!Array.isArray(historyMessages)) {
        console.error("Error fetching history from the application conversation store");
        return res
          .status(500)
          .json({ error: "Failed to fetch conversation history" });
      }
      messages = historyMessages;
    }

    // Build chat history for Gemini (prior messages)
    const chatHistory = messages
      ? [...messages].reverse().map((m) => ({
          role: m.role,
          parts: [{ text: m.content }],
        }))
      : [];

    const hasExcelFiles = files.some(isExcelLikeFile);
    const transactionContext = await buildTransactionContextFromUploads(files);

    // Risk modes: run authorized tools first; results are evidence, not prose.
    const toolResults = isRiskMode
      ? await runTools(req, detectIntents(prompt, investigationMode))
      : [];
    const toolContext = formatToolContext(toolResults);

    // If uploads provided via multipart/form-data, include their extracted text and images
    let composedText = String(prompt);
    let imageParts = [];
    let uploadedText = "";
    try {
      if (files.length) {
        const filesForText = hasExcelFiles
          ? files.filter((f) => !isExcelLikeFile(f))
          : files;
        const extractedText = filesForText.length
          ? await extractTextFromUploads(filesForText)
          : "";
        const uploadedImages = await extractImagesFromUploads(files);
        if (extractedText) {
          uploadedText = extractedText;
          composedText += `\n\n--- Uploaded Files Text ---\n${extractedText}`;
        }
        if (uploadedImages.length) {
          imageParts = uploadedImages.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.data },
          }));
        }
      }
    } catch (_) {
      // ignore upload extraction errors to keep streaming resilient
    }

    if (transactionContext?.contextText) {
      composedText += `\n\n--- Structured Transactions (unscored; do not infer a model score) ---\n${transactionContext.contextText}`;
    }
    if (toolContext) {
      composedText += `\n\n${toolContext}`;
    }

    // Add current user message (text + any image inlineData)
    const userParts = [{ text: composedText }, ...imageParts];
    chatHistory.push({
      role: "user",
      parts: userParts,
    });

    // Default includeSearch to true (enable web search even with files)
    const includeSearch = isRiskMode
      ? false
      : typeof options.includeSearch === "boolean" ? options.includeSearch : true;
    const includeImageSearch = !isRiskMode && options.includeImageSearch !== false;
    const includeYouTube = !isRiskMode && options.includeYouTube === true; // Opt-in for YouTube search

    // Mode-aware system prompt — supports multi-domain copilot + legacy AML
    const analysisContext = isRiskMode
      ? await buildRiskContext(req, investigationMode).catch(() => null)
      : options.analysisContext || null;
    const systemPrompt = buildCopilotPrompt(investigationMode, username, analysisContext);
    const uploadContext = uploadedText ? uploadedText.slice(0, 400) : "";
    const contextualSearchQuery = buildContextualSearchQuery({
      prompt,
      history: messages,
      extra: uploadContext,
    });

    const body = buildRequestBody(
      chatHistory.slice(-10),
      systemPrompt,
      includeSearch,
    );
    const url = `${BASE_URL}/${MODEL_ID}:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`;

    // Parallel search for images and YouTube videos
    console.log(
      "[chatStream] includeYouTube:",
      includeYouTube,
      "contextualSearchQuery:",
      contextualSearchQuery,
    );
    const imageResultsPromise =
      includeImageSearch && contextualSearchQuery
        ? searchImages(contextualSearchQuery)
        : Promise.resolve([]);
    const youtubeResultsPromise =
      includeYouTube && contextualSearchQuery
        ? searchYouTubeVideos(contextualSearchQuery, userId)
        : Promise.resolve(null);

    const [imageResults, youtubeResultsPayload] = await Promise.all([
      imageResultsPromise,
      youtubeResultsPromise,
    ]);
    console.log("[chatStream] youtubeResultsPayload:", youtubeResultsPayload);
    const youtubeVideos = Array.isArray(youtubeResultsPayload)
      ? youtubeResultsPayload
      : Array.isArray(youtubeResultsPayload?.results)
        ? youtubeResultsPayload.results
        : [];
    console.log("[chatStream] youtubeVideos count:", youtubeVideos.length);

    // Prepare SSE response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Send conversation ID immediately
    res.write(`event: conversationId\n`);
    res.write(
      `data: ${JSON.stringify({ conversationId: currentConversationId })}\n\n`,
    );

    // Emit active investigation mode so frontend can show mode badge
    res.write(`event: investigationMode\n`);
    res.write(`data: ${JSON.stringify({ mode: investigationMode, hasAnalysisContext: !!analysisContext })}\n\n`);

    // Emit tool evidence so the UI can render citation cards immediately
    if (toolResults.length) {
      res.write(`event: evidence\n`);
      res.write(`data: ${JSON.stringify({ evidence: toolResults.map((r) => ({ tool: r.tool, label: r.label, ok: r.ok, evidence_id: r.evidence_id, summary: r.summary })) })}\n\n`);

      // Surface Neo4j data as an inline mini-graph in the chat — account
      // neighborhoods (center + neighbors) or a fraud-ring subgraph
      // (nodes + edges) depending on which tools fired.
      const neighborhood = toolResults.find(
        (r) => r.ok && r.tool === "account_neighborhood" && r.data?.neighbors?.length,
      );
      const campaignRing = toolResults.find(
        (r) => r.ok && r.tool === "campaigns" && r.data?.subgraph?.nodes?.length,
      );
      streamedGraphData = neighborhood
        ? { kind: "neighborhood", center: neighborhood.data.center, neighbors: neighborhood.data.neighbors.slice(0, 20) }
        : campaignRing
          ? { kind: "ring", label: campaignRing.data.subgraph.label, nodes: campaignRing.data.subgraph.nodes, edges: campaignRing.data.subgraph.edges }
          : null;
      if (streamedGraphData) {
        res.write(`event: graph\n`);
        res.write(`data: ${JSON.stringify({ graph: streamedGraphData })}\n\n`);
      }
    }

    if (transactionContext?.structured) {
      res.write(`event: transactions\n`);
      res.write(
        `data: ${JSON.stringify({ transactions: transactionContext.structured })}\n\n`,
      );
    }

    // Kick off ML schema generation in parallel so it matches the same prompt/context
    const mlContextParts = [];
    if (prompt) mlContextParts.push(`User request:\n${prompt}`);
    if (transactionContext?.contextText) {
      mlContextParts.push(
        `Structured transactions:\n${transactionContext.contextText.slice(0, 12000)}`,
      );
    }
    if (uploadedText) {
      mlContextParts.push(
        `Extracted file text:\n${uploadedText.slice(0, 6000)}`,
      );
    }
    const mlPrompt = mlContextParts.join("\n\n").trim();
    if (mlPrompt && !isRiskMode) {
      Promise.resolve()
        .then(() => generateMlSchema(mlPrompt))
        .then((ml) => {
          if (res.writableEnded) return;
          res.write(`event: mlSchema\n`);
          res.write(
            `data: ${JSON.stringify({
              payload: ml.payload,
              pattern: ml.pattern,
              sample_id: ml.sample_id,
            })}\n\n`,
          );
        })
        .catch((err) => {
          console.warn("[mlSchema] generation failed:", err?.message || err);
        });
    }

    if (imageResults.length > 0) {
      res.write(`event: images\n`);
      res.write(`data: ${JSON.stringify({ images: imageResults })}\n\n`);
    }

    if (youtubeVideos.length > 0) {
      res.write(`event: youtubeResults\n`);
      res.write(`data: ${JSON.stringify({ videos: youtubeVideos })}\n\n`);
    }

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => "");
      if (isRiskMode) {
        // Deterministic degradation: answer from tool evidence only.
        const fallback = deterministicFallback(toolResults, investigationMode);
        streamedContent = fallback;
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify({ text: fallback })}\n\n`);
      }
      res.write(`event: error\n`);
      res.write(
        `data: ${JSON.stringify({ status: upstream.status, error: txt || upstream.statusText, degraded: isRiskMode })}\n\n`,
      );
      return res.end();
    }

    // Track content for database persistence and emit SSE events for text, code, and sources
    let sseBuffer = "";

    const processSSEBlock = async (block) => {
      const dataLine = block.split(/\r?\n/).find((l) => l.startsWith("data: "));

      if (!dataLine) return;
      const payload = dataLine.slice(6).trim();
      if (!payload || payload === "[DONE]") return;

      try {
        const obj = JSON.parse(payload);
        const cand = obj?.candidates?.[0];
        const parts = cand?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            // Text chunks
            if (typeof p?.text === "string" && p.text.length) {
              streamedContent += p.text;
              res.write(`event: message\n`);
              res.write(`data: ${JSON.stringify({ text: p.text })}\n\n`);
            }



            // Executable code
            if (
              p?.executableCode &&
              typeof p.executableCode.code === "string"
            ) {
              const codePayload = {
                language: p.executableCode.language || "unknown",
                code: p.executableCode.code,
              };
              res.write(`event: code\n`);
              res.write(`data: ${JSON.stringify(codePayload)}\n\n`);
            }

            // Code execution result
            if (
              p?.codeExecutionResult &&
              typeof p.codeExecutionResult.output === "string"
            ) {
              const resultPayload = {
                outcome: p.codeExecutionResult.outcome || "unknown",
                output: p.codeExecutionResult.output,
              };
              res.write(`event: codeResult\n`);
              res.write(`data: ${JSON.stringify(resultPayload)}\n\n`);
            }

            // Function calls (e.g., Excalidraw generation)
            if (p?.functionCall) {
              console.log(
                "[chatStream] Function call detected:",
                p.functionCall,
              );

              // Handle Excalidraw flowchart generation
              if (p.functionCall.name === "generate_excalidraw_flowchart") {
                try {
                  console.log("[chatStream] Executing Excalidraw generation");
                  const { generateExcalidrawFlowchart } =
                    await import("../helpers/groq.js");
                  const flowchartData = await generateExcalidrawFlowchart(
                    p.functionCall.args.prompt,
                    {
                      style: p.functionCall.args.style || "modern",
                      complexity: p.functionCall.args.complexity || "detailed",
                    },
                  );

                  // Capture for DB save
                  streamedExcalidrawData.push(flowchartData);

                  // Record for the follow-up turn so the model can describe it
                  executedFunctionCalls.push({
                    name: p.functionCall.name,
                    args: p.functionCall.args || {},
                    response: {
                      result: `Flowchart generated successfully with ${flowchartData?.elements?.length || 0} elements. It is rendered interactively below your answer.`,
                    },
                  });

                  // Emit excalidraw event
                  res.write(`event: excalidraw\n`);
                  res.write(
                    `data: ${JSON.stringify({ excalidrawData: [flowchartData] })}\n\n`,
                  );

                  // Also emit a text message about the flowchart
                  const message =
                    "I've created a flowchart for you. You can view, download, or expand it below.";
                  streamedContent += message;
                  res.write(`event: message\n`);
                  res.write(`data: ${JSON.stringify({ text: message })}\n\n`);

                  console.log(
                    "[chatStream] Excalidraw flowchart generated and emitted",
                  );
                } catch (error) {
                  console.error(
                    "[chatStream] Error generating Excalidraw:",
                    error,
                  );
                  executedFunctionCalls.push({
                    name: p.functionCall.name,
                    args: p.functionCall.args || {},
                    response: { error: `Flowchart generation failed: ${error.message}` },
                  });
                  const errorMsg = `\n\n[Note: Failed to generate flowchart: ${error.message}]`;
                  streamedContent += errorMsg;
                  res.write(`event: message\n`);
                  res.write(`data: ${JSON.stringify({ text: errorMsg })}\n\n`);
                }
              }
            }
          }
        }

        // Collect sources from grounding metadata if present
        const groundingChunks = cand?.groundingMetadata?.groundingChunks;
        if (Array.isArray(groundingChunks)) {
          for (const gc of groundingChunks) {
            const uri = gc?.web?.uri;
            if (typeof uri === "string" && uri.startsWith("http")) {
              streamedSources.add(uri);
            }
          }
          if (groundingChunks.length) {
            console.log(
              "[chatStream] collected grounding URLs from chunk:",
              groundingChunks.map((g) => g?.web?.uri).filter(Boolean),
            );
          }
        }

        // Track finish reason to ensure stream completion
        if (cand?.finishReason) {
          lastFinishReason = cand.finishReason;
          // Treat both STOP and MAX_TOKENS as complete (client should handle truncation)
          if (
            cand.finishReason === "STOP" ||
            cand.finishReason === "MAX_TOKENS"
          ) {
            streamComplete = true;
            console.log(
              `[chatStream] Received finishReason: ${cand.finishReason} - stream is complete`,
            );
          }
          const emitFinish = () => {
            if (res.writableEnded) return;
            res.write(`event: finish\n`);
            res.write(
              `data: ${JSON.stringify({ finishReason: cand.finishReason })}\n\n`,
            );
          };

          if (cand.finishReason === "STOP") {
            setTimeout(emitFinish, STREAM_FINISH_DEBOUNCE_MS);
          } else {
            emitFinish();
          }
        }
      } catch (e) {
        // Most parse errors will be due to partial JSON; the remainder stays in sseBuffer
        console.warn("Failed to parse SSE JSON block:", e.message);
      }
    };

    // Serialize SSE block processing: function calls (e.g., Excalidraw via Groq)
    // are async and can outlive the upstream "end" event. Without this queue the
    // "end" handler would see an empty streamedContent and emit a premature
    // fallback message before the flowchart finishes.
    let processingQueue = Promise.resolve();

    upstream.body.on("data", (chunk) => {
      const chunkStr = chunk.toString();
      processingQueue = processingQueue.then(async () => {
        sseBuffer += chunkStr;

        // Split into SSE blocks; last block may be incomplete and stays in buffer
        const blocks = sseBuffer.split(/\r?\n\r?\n/);
        sseBuffer = blocks.pop() || "";

        for (const block of blocks) {
          await processSSEBlock(block);
        }
      });
    });

    upstream.body.on("end", async () => {
      // Wait for any in-flight block processing (function calls) to finish
      await processingQueue.catch(() => {});

      console.log("Gemini stream ended");
      console.log(
        `[chatStream] Stream completion status: streamComplete=${streamComplete}, lastFinishReason=${lastFinishReason}, contentLength=${streamedContent.length}`,
      );

      // Process any trailing buffer that lacked the final delimiter
      if (sseBuffer.trim().length > 0) {
        console.log("[chatStream] Flushing trailing SSE buffer block");
        await processSSEBlock(sseBuffer);
        sseBuffer = "";
      }

      // Second turn: if the model invoked function calls, hand the results back
      // so it can write real explanatory prose around the generated artifact —
      // otherwise the answer is just the diagram with no narrative.
      if (executedFunctionCalls.length > 0) {
        try {
          const followupBody = {
            contents: [
              ...chatHistory.slice(-10),
              {
                role: "model",
                parts: executedFunctionCalls.map((fc) => ({
                  functionCall: { name: fc.name, args: fc.args },
                })),
              },
              {
                role: "user",
                parts: [
                  ...executedFunctionCalls.map((fc) => ({
                    functionResponse: { name: fc.name, response: fc.response },
                  })),
                  {
                    text: "Describe the tool result to the user in plain prose (2-4 sentences or a short bullet list). Do NOT output raw JSON, code blocks, function names, or the literal functionResponse payload.",
                  },
                ],
              },
            ],
            systemInstruction: systemPrompt
              ? { role: "system", parts: [{ text: systemPrompt }] }
              : undefined,
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
          };

          const followupResp = await fetch(
            `${BASE_URL}/${MODEL_ID}:generateContent?key=${env.GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(followupBody),
            },
          );

          if (followupResp.ok) {
            const followupData = await followupResp.json();
            let followupText = (followupData?.candidates?.[0]?.content?.parts || [])
              .map((part) => part.text)
              .filter((t) => typeof t === "string")
              .join("")
              .trim();
            // Strip any code block that leaks the internal tool payload
            // (functionResponse/functionCall JSON or the raw Excalidraw schema).
            followupText = followupText
              .replace(/```[\w-]*\n?[\s\S]*?```/g, (block) =>
                /functionResponse|functionCall|generate_excalidraw_flowchart|"elements"\s*:\s*\[/.test(block)
                  ? ""
                  : block,
              )
              .replace(/\n{3,}/g, "\n\n")
              .trim();
            if (followupText) {
              const separator = streamedContent ? "\n\n" : "";
              streamedContent += separator + followupText;
              if (!res.writableEnded) {
                res.write(`event: message\n`);
                res.write(`data: ${JSON.stringify({ text: separator + followupText })}\n\n`);
              }
            }
          } else {
            console.warn("[chatStream] function-call follow-up HTTP", followupResp.status);
          }
        } catch (followupError) {
          console.warn(
            "[chatStream] function-call follow-up failed:",
            followupError?.message || followupError,
          );
        }
      }

      try {
        if (!streamedContent) {
          const fallbackMessage = isRiskMode
            ? deterministicFallback(toolResults, investigationMode)
            : "I couldn't generate a response from the model for that upload. Try a smaller file or add a specific question.";
          streamedContent = fallbackMessage;
          if (!res.writableEnded) {
            res.write(`event: message\n`);
            res.write(`data: ${JSON.stringify({ text: fallbackMessage })}\n\n`);
          }
        }

        // Strip hallucinated pseudo tool-call markup (<tool_code>…</tool_code>)
        // before persisting — internal protocol, never user-facing text.
        streamedContent = streamedContent
          .replace(/<tool_(code|call|response|result|output)>[\s\S]*?(<\/tool_\1>|$)/gi, "")
          .replace(/<function_(call|response|result)>[\s\S]*?(<\/function_\1>|$)/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        let mermaidProcessingResult = { content: streamedContent, blocks: [] };
        try {
          mermaidProcessingResult = await processMermaidBlocks({
            content: streamedContent,
            prompt,
            userId,
          });
          streamedContent = mermaidProcessingResult.content;
          if (mermaidProcessingResult.blocks.length > 0 && !res.writableEnded) {
            res.write(`event: mermaid\n`);
            res.write(
              `data: ${JSON.stringify({ blocks: mermaidProcessingResult.blocks })}\n\n`,
            );
          }
        } catch (mermaidError) {
          console.warn(
            "Mermaid processing failed:",
            mermaidError?.message || mermaidError,
          );
        }

        if (!isRiskMode && shouldIncludeSocial(prompt, options)) {
          console.log("[socialSearch] running (stream) for prompt:", prompt);
          const socialResults = await searchSocialProfiles(prompt, {
            location: options.location,
          });
          const reason = socialResults?.some((r) => r?.results?.length)
            ? ""
            : isSocialSearchEnabled()
              ? "No public profiles found."
              : "Social search disabled: missing GOOGLE_API_KEY or GOOGLE_CSE_ID.";
          if (!res.writableEnded) {
            res.write(`event: socials\n`);
            res.write(
              `data: ${JSON.stringify({ socials: socialResults || [], reason })}\n\n`,
            );
          }
        }

        if (streamedSources.size > 0) {
          console.log(
            `[chatStream] emitting sources from streamed grounding: count=${streamedSources.size}`,
          );
          // Resolve titles for sources concurrently with a per-URL timeout
          const urls = Array.from(streamedSources);
          const titlePromises = urls.map(async (u) => {
            try {
              // Race fetchPageTitle against a 2s timeout to avoid hanging
              const title = await Promise.race([
                fetchPageTitle(u),
                new Promise((resolve) => setTimeout(() => resolve(""), 2000)),
              ]);
              return { url: u, title };
            } catch {
              return { url: u, title: "" };
            }
          });
          const settledResults = await Promise.allSettled(titlePromises);
          finalSourcesWithTitles = settledResults
            .filter((r) => r.status === "fulfilled")
            .map((r) => r.value);

          // Emit structured sources event
          console.log(
            "[chatStream] sourcesWithTitles:",
            finalSourcesWithTitles,
          );
          res.write(`event: sources\n`);
          res.write(
            `data: ${JSON.stringify({ sources: finalSourcesWithTitles })}\n\n`,
          );
        } else {
          console.log(
            "[chatStream] no streamed grounding sources found; emitting empty sources event",
          );
          if (!res.writableEnded) {
            res.write(`event: sources\n`);
            res.write(`data: {"sources": []}\n\n`);
          }
        }
      } catch (e) {
        console.warn("Failed to emit sources/title message:", e?.message || e);
      }

      // Save messages to database ONLY after streaming completes
      try {
        if (!streamComplete) {
          console.warn(
            "[chatStream] WARNING: Stream ended without finishReason: STOP or MAX_TOKENS. Content may be incomplete. streamComplete=",
            streamComplete,
            "lastFinishReason=",
            lastFinishReason,
          );
        }

        console.log(
          `[chatStream] Saving to database: contentLength=${streamedContent.length}, sourcesCount=${finalSourcesWithTitles.length}, streamComplete=${streamComplete}`,
        );

        const saveResult = await conversations.append(req, currentConversationId, [
          {
            role: "user",
            content: prompt,
            sources: [],
          },
          {
            role: "model",
            content: streamedContent,
            sources: finalSourcesWithTitles,
            images: imageResults,
            videos: youtubeVideos,
            excalidraw: streamedExcalidrawData,
            graph: streamedGraphData,
          },
        ]);

        if (!saveResult?.ok) {
          console.error("Error saving streamed messages to the application conversation store");
        } else {
          console.log(
            `[chatStream] Successfully saved messages with ${finalSourcesWithTitles.length} sources and ${streamedContent.length} characters`,
          );
        }

        // Update conversation timestamp
        console.log(`[chatStream] Conversation ${currentConversationId} persisted`);
      } catch (dbError) {
        console.error("Database error after streaming:", dbError);
      }

      await sleep(STREAM_CLOSE_DELAY_MS);
      res.end();
    });

    upstream.body.on("error", (err) => {
      console.error("Gemini stream error:", err);
      try {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ message: err?.message || "stream error" })}\n\n`,
        );
      } finally {
        res.end();
      }
    });
  } catch (error) {
    console.error("Error in handleChatStreamGenerate:", error);
    // Ensure we don't hang the stream on unexpected errors
    try {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
      }
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ message: error?.message || "stream error" })}\n\n`,
        );
      }
    } catch (_) {
      // swallow
    } finally {
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {}
      }
    }
  }
}

// Get all conversations for the authenticated user
export async function getConversations(req, res) {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const storedConversations = await conversations.list(req);

    if (!Array.isArray(storedConversations)) {
      // Mongo-authenticated users always use the authoritative application store.
      console.warn("Conversations unavailable from the application store");
      return res.status(503).json({ error: "Conversation persistence unavailable" });
    }

    res.json(storedConversations);
  } catch (error) {
    console.error("Error in getConversations:", error);
    res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
}

export async function getConversationHistory(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.userId;

    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    // Fetch conversation and verify ownership (if user is authenticated)
    const conversation = await conversations.get(req, conversationId);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (userId && conversation.user_id && conversation.user_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messages = conversation.messages || [];

    if (!Array.isArray(messages)) {
      console.error("Error fetching conversation history from the application store");
      return res
        .status(500)
        .json({ error: "Failed to fetch conversation history" });
    }

    res.json({ ...conversation, messages });
  } catch (error) {
    console.error("Error in getConversationHistory:", error);
    const isNetwork = (error?.message || "")
      .toLowerCase()
      .includes("fetch failed");
    res.status(error.status || (isNetwork ? 503 : 500)).json({
      error: isNetwork
        ? "Application-store network error while fetching conversation"
        : error.message,
      hint: isNetwork
        ? "Verify GRAPH_API_URL and application API connectivity"
        : undefined,
    });
  }
}

// Delete a conversation and its messages (requires authentication)
export async function deleteConversation(req, res) {
  try {
    const { conversationId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!conversationId) {
      return res.status(400).json({ error: "Conversation ID is required" });
    }

    // Verify ownership
    const conversation = await conversations.get(req, conversationId);

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.user_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Delete messages first
    const deleted = await conversations.remove(req, conversationId);
    if (!deleted?.success) {
      console.error("Error deleting conversation messages from the application store");
      return res
        .status(500)
        .json({ error: "Failed to delete conversation messages" });
    }

    // Delete conversation
    return res.json({ success: true });
  } catch (error) {
    console.error("Error in deleteConversation:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
}

/**
 * Generate ML-ready JSON (P1–P6 format) from user prompt via Groq.
 * POST body: { prompt: string, pattern?: string } (pattern optional: "P1".."P6" or alias like "Round Trip", "Hawala")
 * Response: { payload, pattern, sample_id } for use by the ML model.
 */
export async function handleMlGenerate(req, res) {
  try {
    const { prompt, pattern } = req.body || {};
    const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    if (!trimmedPrompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await generateMlSchema(trimmedPrompt, { pattern: pattern || undefined });
    return res.json({
      payload: result.payload,
      pattern: result.pattern,
      sample_id: result.sample_id,
    });
  } catch (error) {
    console.error("Error in handleMlGenerate:", error);
    res.status(500).json({
      error: error.message || "ML schema generation failed",
    });
  }
}

/**
 * Classify an AML sample against P1–P6 patterns. Scores 0.0–9.99 (never 10), threshold 0.75.
 * POST body: { sample: object } (ML schema payload from ml-generate).
 * Response: { best_pattern, best_risk_score, best_threshold, best_above_threshold, best_decision, all_results }.
 */
export async function handleClassify(req, res) {
  try {
    const { sample } = req.body || {};
    const payload = Array.isArray(sample) ? { transactions: sample } : sample;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Sample payload is required" });
    }

    const result = await classifyAmlSample(payload);
    return res.json(result);
  } catch (error) {
    console.error("Error in handleClassify:", error);
    res.status(500).json({
      error: error.message || "Classification failed",
    });
  }
}
