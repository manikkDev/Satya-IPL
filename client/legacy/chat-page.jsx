"use client"

import React, { Suspense, useCallback, useMemo, useState, useRef, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { ChatForm } from "@/components/ui/chat"
import { CopyButton } from "@/components/ui/copy-button"
import { MessageInput } from "@/components/ui/message-input"
import { MessageList } from "@/components/ui/message-list"
import { createInitialAssistantStatuses } from "@/components/ui/typing-indicator"
import {
  ThumbsUp,
  ThumbsDown,
  Search,
  Plus,
  Trash2,
  LogOut,
  RotateCcw,
  ChevronDown,
  X,
  BookOpen,
  MessageCircle,
  Shield,
  AlertTriangle,
  Link as LinkIcon,
  Radio,
  DollarSign,
  Network,
} from "lucide-react"
import { SuggestionDropdown } from "@/components/ui/suggestion-dropdown"
import { riskFuzzySearch, defaultSuggestions } from "@/services/suggestions/riskSuggestions"
import Image from "next/image"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { FeedbackDialog } from "@/components/ui/feedback-dialog"
import { toast } from "sonner"
import { TTSButton } from "@/components/ui/tts-button"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { SERVER_URL_1, SERVER_URL } from "@/utils/commonHelper"

// Call chatbot backend (5001) and other services directly — no Next.js API proxy
const CHAT_API_BASE = `${SERVER_URL_1}/api/chat`

function normalizeImageResults(raw) {
  if (!Array.isArray(raw)) return undefined
  const normalized = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const data = item
      const imageUrl =
        typeof data.imageUrl === "string" ? data.imageUrl
        : typeof data.url === "string" ? data.url
        : typeof data.link === "string" ? data.link
        : typeof data.src === "string" ? data.src
        : typeof data.image?.url === "string" ? data.image.url
        : typeof data.image?.link === "string" ? data.image.link
        : null
      const pageUrl =
        typeof data.pageUrl === "string" ? data.pageUrl
        : typeof data.contextLink === "string" ? data.contextLink
        : typeof data.image?.contextLink === "string" ? data.image.contextLink
        : null
      const title = typeof data.title === "string" ? data.title : null
      const thumbnailUrl =
        typeof data.thumbnailUrl === "string" ? data.thumbnailUrl
        : typeof data.thumbnail === "string" ? data.thumbnail
        : typeof data.image?.thumbnailLink === "string" ? data.image.thumbnailLink
        : null
      if (!imageUrl) return null
      return { title, imageUrl, pageUrl, thumbnailUrl }
    })
    .filter((entry) => entry !== null)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeVideoResults(raw) {
  if (!raw) return undefined
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.results)
      ? raw.results
      : Array.isArray(raw?.items)
        ? raw.items
        : []
  if (!Array.isArray(source)) return undefined
  const normalized = source
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const videoId =
        typeof item.videoId === "string" ? item.videoId
        : typeof item.id === "string" ? item.id
        : typeof item.video_id === "string" ? item.video_id
        : null
      const url =
        typeof item.url === "string" ? item.url
        : videoId ? `https://www.youtube.com/watch?v=${videoId}` : null
      if (!url && !videoId) return null
      return {
        videoId,
        url,
        title: item.title,
        description: item.description,
        channelTitle: item.channelTitle,
        channelId: item.channelId,
        publishedAt: item.publishedAt,
        thumbnails: item.thumbnails,
      }
    })
    .filter(Boolean)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeSocialProfiles(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((group) => {
      if (!group || typeof group !== "object") return null
      const platform = typeof group.platform === "string" ? group.platform : "Social"
      const results = Array.isArray(group.results) ? group.results : []
      const normalizedResults = results
        .map((item) => {
          if (!item || typeof item !== "object") return null
          return {
            handle: typeof item.handle === "string" ? item.handle : "",
            url: typeof item.url === "string" ? item.url : "",
            title: typeof item.title === "string" ? item.title : "",
            snippet: typeof item.snippet === "string" ? item.snippet : "",
          }
        })
        .filter((item) => item && item.url)
      return { platform, results: normalizedResults }
    })
    .filter((g) => g && g.results.length > 0)
}

function applyMermaidReplacements(content, blocks) {
  if (typeof content !== "string" || !Array.isArray(blocks) || blocks.length === 0) return content
  return blocks.reduce((acc, block) => {
    if (typeof block.original === "string" && typeof block.replacement === "string") {
      return acc.replace(block.original, block.replacement)
    }
    return acc
  }, content)
}


const HeroBackdropCanvas = () => {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const primary = "0,232,122"
    const danger = "239,68,68"
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0

    const resize = () => {
      w = canvas.offsetWidth
      h = canvas.offsetHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener("resize", resize)

    const nodes = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 2.2 + 1.4,
      flagged: i < 3,
      phase: Math.random() * Math.PI * 2,
    }))

    nodes[0] = { ...nodes[0], x: w * 0.48, y: h * 0.46, r: 5, flagged: true }
    nodes[1] = { ...nodes[1], x: w * 0.42, y: h * 0.58, r: 4.2, flagged: true, vx: -0.1, vy: 0.06 }
    nodes[2] = { ...nodes[2], x: w * 0.58, y: h * 0.58, r: 4.2, flagged: true, vx: 0.08, vy: -0.1 }

    const loop = [nodes[0], nodes[1], nodes[2]]
    const cpts = [
      { t: 0, sp: 0.0042 },
      { t: 0.33, sp: 0.0055 },
      { t: 0.67, sp: 0.0036 },
    ]
    const lerp = (a, b, t) => a + (b - a) * t
    const getCP = (t) => {
      const s = Math.floor(t * 3) % 3
      const st = (t * 3) % 1
      const f = loop[s]
      const to = loop[(s + 1) % 3]
      return { x: lerp(f.x, to.x, st), y: lerp(f.y, to.y, st) }
    }

    let frame = 0
    const draw = () => {
      frame += 1
      ctx.clearRect(0, 0, w, h)

      nodes.forEach((n) => {
        n.x += n.vx
        n.y += n.vy
        if (n.x < 18 || n.x > w - 18) n.vx *= -1
        if (n.y < 18 || n.y > h - 18) n.vy *= -1
      })

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
          if (d > 170) continue
          const alpha = (1 - d / 170) * 0.1
          const sus = nodes[i].flagged && nodes[j].flagged
          ctx.beginPath()
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.setLineDash(sus ? [6, 4] : [])
          ctx.strokeStyle = sus
            ? `rgba(${danger},${alpha * 4})`
            : `rgba(${primary},${alpha})`
          ctx.lineWidth = sus ? 1.2 : 0.65
          ctx.stroke()
          ctx.setLineDash([])
        }
      }

      cpts.forEach((p) => {
        p.t = (p.t + p.sp) % 1
        const pt = getCP(p.t)
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 2.4, 0, 6.28)
        ctx.fillStyle = `rgba(${danger},0.88)`
        ctx.fill()
      })

      nodes.forEach((n) => {
        const pulse = Math.sin(frame * 0.022 + n.phase)
        if (n.flagged) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + 8 + pulse * 4, 0, 6.28)
          ctx.strokeStyle = `rgba(${danger},${0.08 + pulse * 0.03})`
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r, 0, 6.28)
          ctx.fillStyle = `rgba(${danger},0.18)`
          ctx.fill()
          ctx.strokeStyle = `rgba(${danger},0.7)`
          ctx.lineWidth = 1.3
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r, 0, 6.28)
          ctx.fillStyle = `rgba(${primary},0.06)`
          ctx.fill()
          ctx.strokeStyle = `rgba(${primary},${0.16 + pulse * 0.05})`
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
      })

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener("resize", resize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} className="chat-bg-canvas" />
}

function ChatPageContent() {
  const { user, token, logout } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const inputRef = useRef(null)
  const headerRef = useRef(null)
  const footerRef = useRef(null)
  const abortControllerRef = useRef(null)
  const assistantMessageIdRef = useRef(null)
  const [conversations, setConversations] = useState([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [loadingConversationId, setLoadingConversationId] = useState(null)
  const [assistantStatuses, setAssistantStatuses] = useState(createInitialAssistantStatuses())
  const [includeYouTube, setIncludeYouTube] = useState(true)
  const [includeImageSearch, setIncludeImageSearch] = useState(true)
  const [viewportHeight, setViewportHeight] = useState("100dvh")
  const [historyQuery, setHistoryQuery] = useState("")
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const searchParams = useSearchParams()
  const [investigationMode, setInvestigationMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const m = params.get('mode') || params.get('investigationMode') || 'copilot'
      return m
    }
    return 'copilot'
  })
  const [activeModeBadge, setActiveModeBadge] = useState(null)
  const [analysisContext, setAnalysisContext] = useState(null)

  useEffect(() => {
    if (!user) return
    const mode = user.role === "analyst" || user.role === "admin" ? "risk_analyst" : "risk_citizen"
    setInvestigationMode(mode)
    setIncludeYouTube(false)
    setIncludeImageSearch(false)
  }, [user])

  // Consume analysis context from sessionStorage when arriving from analyze page
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('context') === 'analysis') {
      try {
        const raw = sessionStorage.getItem('app_analysis_context')
        if (raw) {
          const ctx = JSON.parse(raw)
          setAnalysisContext(ctx)
          sessionStorage.removeItem('app_analysis_context')
          // Inject a context-aware welcome message
          const score = ctx.risk_score?.overall_score ?? 0
          const family = ctx.classification?.primary_family?.replace(/_/g,' ') || 'unknown'
          const greetMsg = `I've loaded your analysis context.\n\n**Artifact:** \`${ctx.artifact_id || 'unknown'}\`\n**Threat family:** ${family}\n**Risk score:** ${score}/100\n**Indicators extracted:** ${ctx.indicators?.length || 0}\n\nHow would you like me to assist? I can write an analyst brief, explain the attack technique, suggest next investigation steps, or produce an executive summary.`
          setMessages([{
            id: crypto.randomUUID(),
            role: 'assistant',
            content: greetMsg,
            createdAt: new Date(),
            sources: [], images: [], videos: [], socialProfiles: [], isComplete: true,
          }])
        }
      } catch (_) {}
    }
  }, [])

  const displayName = user?.username || user?.name || "User"
  const displayEmail = user?.email ?? ""
  const userInitial = useMemo(() => {
    const source = user?.email || user?.username || user?.name
    return source ? source.slice(0, 1).toUpperCase() : "U"
  }, [user])
  const userAvatar = user?.profileImageUrl || user?.avatarUrl || null

  const { salutation, firstName } = useMemo(() => {
    const now = new Date()
    const hour = now.getHours()
    const base = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    return { salutation: base, firstName: displayName?.split(" ")[0] ?? "there" }
  }, [displayName])

  const [layoutHeights, setLayoutHeights] = useState({ header: 64, footer: 88 })

  useEffect(() => {
    const updateHeights = () => {
      setLayoutHeights({
        header: headerRef.current?.offsetHeight ?? 64,
        footer: footerRef.current?.offsetHeight ?? 88,
      })
    }
    updateHeights()
    window.addEventListener("resize", updateHeights)
    return () => window.removeEventListener("resize", updateHeights)
  }, [])

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window === "undefined") return
      const viewport = window.visualViewport
      const height = viewport?.height ?? window.innerHeight
      setViewportHeight(`${height}px`)
    }
    updateViewport()
    const viewport = typeof window !== "undefined" ? window.visualViewport : null
    viewport?.addEventListener("resize", updateViewport)
    viewport?.addEventListener("scroll", updateViewport)
    window.addEventListener("orientationchange", updateViewport)
    window.addEventListener("resize", updateViewport)
    return () => {
      viewport?.removeEventListener("resize", updateViewport)
      viewport?.removeEventListener("scroll", updateViewport)
      window.removeEventListener("orientationchange", updateViewport)
      window.removeEventListener("resize", updateViewport)
    }
  }, [])

  const formatConversationDate = useCallback((iso) => {
    if (!iso) return ""
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "numeric" }).format(date)
  }, [])

  const normalizeConversationSummary = useCallback((conversation) => {
    if (!conversation || typeof conversation !== "object" || !conversation.id) return null
    const id = String(conversation.id)
    const rawTitle = conversation.title ?? conversation.name ?? ""
    const title = String(rawTitle).trim() || `Chat ${id.slice(0, 6) || id}`
    const updatedAt = conversation.updated_at ?? conversation.updatedAt ?? conversation.created_at ?? conversation.createdAt ?? null
    const createdAt = conversation.created_at ?? conversation.createdAt ?? conversation.updated_at ?? conversation.updatedAt ?? null
    return { id, title, updated_at: updatedAt ?? null, created_at: createdAt ?? null }
  }, [])

  const loadConversations = useCallback(async () => {
    setIsHistoryLoading(true)
    try {
      const response = await fetch(`${CHAT_API_BASE}/conversations`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Failed to load conversations")
      }
      const data = await response.json()
      const normalized = Array.isArray(data)
        ? data.map(normalizeConversationSummary).filter(Boolean)
        : []
      setConversations(normalized)
    } catch (error) {
      console.error("Failed to load conversations:", error)
      toast("Failed to load chat history")
      setConversations([])
    } finally {
      setIsHistoryLoading(false)
    }
  }, [normalizeConversationSummary, token])

  useEffect(() => { loadConversations() }, [loadConversations])
  useEffect(() => { if (!currentConversationId) return; loadConversations() }, [currentConversationId, loadConversations])

  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target
      if (isHistoryOpen && !(target instanceof Element && target.closest(".history-dropdown"))) setIsHistoryOpen(false)
      if (isProfileOpen && !(target instanceof Element && target.closest(".profile-dropdown"))) setIsProfileOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isHistoryOpen, isProfileOpen])

  const stop = useCallback(() => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
    setIsGenerating(false)
    setAssistantStatuses(createInitialAssistantStatuses())
  }, [])

  const startNewChat = useCallback(() => {
    stop()
    setMessages([])
    setCurrentConversationId(null)
    setInput("")
    setShowSuggestions(false)
    setLoadingConversationId(null)
    setAssistantStatuses(createInitialAssistantStatuses())
    setIsProfileOpen(false)
  }, [stop])

  const normalizeMessageFromHistory = useCallback((message) => {
    const role = message?.role === "model" ? "assistant" : message?.role ?? "assistant"
    const createdAtIso = message?.created_at ?? message?.createdAt
    const normalizedVideos = normalizeVideoResults(message?.videos ?? message?.youtubeResults)
    return {
      id: message?.id ? String(message.id) : crypto.randomUUID(),
      role: role === "assistant" || role === "user" || role === "system" ? role : "assistant",
      content: message?.content ?? "",
      createdAt: createdAtIso ? new Date(createdAtIso) : undefined,
      sources: Array.isArray(message?.sources) ? message.sources : undefined,
      chartUrl: typeof message?.charts === "string" ? message.charts : Array.isArray(message?.charts) ? message.charts[0] : undefined,
      chartUrls: Array.isArray(message?.charts)
        ? message.charts.filter((url) => typeof url === "string" && url.trim().length > 0)
        : typeof message?.charts === "string" && message.charts.trim().length > 0 ? [message.charts] : undefined,
      excalidrawData: message.excalidraw ?? message.excalidraw_data ?? message.excalidrawData ?? undefined,
      graphData: message.graph ?? message.graphData ?? undefined,
      images: normalizeImageResults(message?.images),
      videos: normalizedVideos,
      socialProfiles: normalizeSocialProfiles(message?.socialProfiles ?? message?.socials),
      socialReason: typeof message?.socialReason === "string" ? message.socialReason : "",
    }
  }, [])

  const attachPromptTitlesToHistory = useCallback((historyMessages) => {
    let lastUserContent
    return historyMessages.map((msg) => {
      if (msg.role === "user") { lastUserContent = msg.content || ""; return msg }
      if (msg.role === "assistant" && !msg.promptTitle && lastUserContent && lastUserContent.trim().length > 0) {
        return { ...msg, promptTitle: lastUserContent }
      }
      return msg
    })
  }, [])

  const handleConversationSelect = useCallback(async (conversationId) => {
    stop()
    setLoadingConversationId(conversationId)
    setIsHistoryOpen(false)
    setIsProfileOpen(false)
    try {
      const response = await fetch(`${CHAT_API_BASE}/conversations/${conversationId}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Failed to load conversation")
      }
      const data = await response.json()
      const historyMessages = Array.isArray(data?.messages) ? data.messages : []
      const normalizedMessages = historyMessages.map(normalizeMessageFromHistory)
      const withTitles = attachPromptTitlesToHistory(normalizedMessages)
      setMessages(withTitles)
      setCurrentConversationId(conversationId)
    } catch (error) {
      console.error("Failed to load conversation:", error)
      toast("Failed to load that conversation")
    } finally {
      setLoadingConversationId(null)
    }
  }, [attachPromptTitlesToHistory, normalizeMessageFromHistory, stop, token])

  const handleDeleteConversation = useCallback(async (conversationId, event) => {
    event?.preventDefault()
    event?.stopPropagation()
    try {
      const response = await fetch(`${CHAT_API_BASE}/conversations/${conversationId}`, { method: "DELETE", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Failed to delete conversation")
      }
      setConversations((prev) => prev.filter((c) => c.id !== conversationId))
      if (currentConversationId === conversationId) startNewChat()
    } catch (error) {
      console.error("Failed to delete conversation:", error)
      toast("Failed to delete conversation")
    }
  }, [currentConversationId, startNewChat, token])

  const filteredSuggestions = useMemo(() => {
    if (!input || input.trim().length < 2) return []
    return riskFuzzySearch(input, investigationMode).slice(0, 5)
  }, [input, investigationMode])

  const filteredHistory = useMemo(() => {
    if (!historyQuery.trim()) return conversations
    const query = historyQuery.toLowerCase()
    return conversations.filter((c) => {
      const title = c.title || `Chat ${c.id.slice(0, 6)}`
      return title.toLowerCase().includes(query) || c.id.toLowerCase().includes(query)
    })
  }, [historyQuery, conversations])

  const handleInputChange = (e) => {
    setInput(e.target.value)
    setShowSuggestions(e.target.value.length > 0)
  }

  const handleSuggestionSelect = (suggestion) => {
    setInput(suggestion)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const simulateAssistant = async (userContent, attachments) => {
    try {
      const conversationId = currentConversationId
      abortControllerRef.current = new AbortController()

      let hasGeminiTransactions = false

      const promptText = typeof userContent === "string" ? userContent.trim() : ""

      let response
      if (attachments && attachments.length > 0) {
        const formData = new FormData()
        formData.append("prompt", userContent)
        formData.append("options", JSON.stringify({ includeYouTube, includeImageSearch, investigationMode, analysisContext: analysisContext || undefined }))
        Array.from(attachments).forEach((file) => formData.append("files", file, file.name))
        response = await fetch(`${CHAT_API_BASE}/stream`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
          signal: abortControllerRef.current.signal,
        })
      } else {
        response = await fetch(`${CHAT_API_BASE}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ prompt: userContent, options: { includeYouTube, includeImageSearch, investigationMode, analysisContext: analysisContext || undefined } }),
          signal: abortControllerRef.current.signal,
        })
      }

      const classifySample = async (sample, mid) => {
        if (!mid || !sample || typeof sample !== "object") return
        try {
          const res = await fetch(`${SERVER_URL_1}/api/chat/classify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ sample }),
          })
          const classificationResponse = res.ok ? await res.json() : { error: res.statusText || "Classification failed" }
          const renderDelayMs = 900 + Math.floor(Math.random() * 600)
          await new Promise((resolve) => setTimeout(resolve, renderDelayMs))
          if (mid) setMessages((prev) => prev.map((msg) => msg.id === mid ? { ...msg, classificationResponse } : msg))
        } catch (err) {
          const renderDelayMs = 900 + Math.floor(Math.random() * 600)
          await new Promise((resolve) => setTimeout(resolve, renderDelayMs))
          if (mid) setMessages((prev) => prev.map((msg) => msg.id === mid ? { ...msg, classificationResponse: { error: err?.message || "Classification request failed" } } : msg))
        }
      }

      // ML schema now arrives via SSE `mlSchema` event from backend to keep it aligned with the stream context.

      if (!response.ok) throw new Error((await response.text()) || "Failed to get response from the API")

      setAssistantStatuses((prev) => ({ ...prev, searching: "complete", responding: "active" }))

      const assistantMessageId = crypto.randomUUID()
      assistantMessageIdRef.current = assistantMessageId
      setMessages((prev) => [...prev, {
        id: assistantMessageId, role: "assistant", content: "", createdAt: new Date(),
        sources: [], chartUrl: null, chartUrls: [], images: [], videos: [], socialProfiles: [], socialReason: "", promptTitle: userContent, isComplete: false,
      }])

      let resolvedConversationId = conversationId || null
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let streamedContent = ""
      let streamedSources = []
      let streamedEvidence = []
      let streamedImages = []
      let streamedVideos = []
      let streamedCodeSnippets = []
      let streamedExecutionOutputs = []
      let streamedMermaidBlocks
      let currentEvent = ""
      let updateTimer = null
      let pendingUpdate = false

      const processSseLine = (line) => {
        if (!line.trim()) { currentEvent = ""; return }
        if (line.startsWith("event: ")) { currentEvent = line.slice(7).trim(); return }
        if (!line.startsWith("data: ")) return
        const data = line.slice(6).trim()
        if (!data) return
        try {
          const parsed = JSON.parse(data)
          if (currentEvent === "investigationMode") {
            if (parsed.mode) setActiveModeBadge(parsed.mode)
          } else if (currentEvent === "conversationId" || parsed.conversationId) {
            resolvedConversationId = parsed.conversationId
            if (parsed.conversationId !== currentConversationId) setCurrentConversationId(parsed.conversationId)
          } else if (currentEvent === "message" && parsed.text && typeof parsed.text === "string") {
            streamedContent += parsed.text
            if (!pendingUpdate) {
              pendingUpdate = true
              if (updateTimer) clearTimeout(updateTimer)
              updateTimer = setTimeout(() => {
                setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: streamedContent, createdAt: new Date(), isComplete: false } : msg))
                pendingUpdate = false
              }, 50)
            }
          } else if (currentEvent === "transactions" && parsed.transactions) {
            hasGeminiTransactions = true
          } else if (currentEvent === "images") {
            const normalized = normalizeImageResults(parsed?.images ?? parsed?.imageResults ?? parsed?.items ?? parsed)
            if (normalized) { streamedImages = normalized; setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, images: normalized } : msg)) }
          } else if (currentEvent === "sources" && parsed.sources && Array.isArray(parsed.sources)) {
            streamedSources = parsed.sources
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, sources: streamedSources } : msg))
          } else if (currentEvent === "evidence" && Array.isArray(parsed.evidence ?? parsed.results)) {
            streamedEvidence = parsed.evidence ?? parsed.results
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, toolEvidence: streamedEvidence } : msg))
          } else if (currentEvent === "mlSchema") {
            const payload = parsed?.payload ?? parsed
            const pattern = typeof parsed?.pattern === "string" ? parsed.pattern : undefined
            const sampleId = typeof parsed?.sample_id === "string" ? parsed.sample_id : undefined
            if (payload && typeof payload === "object") {
              setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, mlPayload: payload, mlPattern: pattern, mlSampleId: sampleId } : msg))
              void classifySample(payload, assistantMessageId)
            }
          } else if (currentEvent === "socials") {
            const socialProfiles = normalizeSocialProfiles(parsed?.socials ?? parsed)
            const socialReason = typeof parsed?.reason === "string" ? parsed.reason : ""
            if (socialProfiles.length > 0 || socialReason) {
              setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId
                ? { ...msg, socialProfiles, socialReason }
                : msg))
            }
          } else if (currentEvent === "code" && parsed.code) {
            streamedCodeSnippets = [...(streamedCodeSnippets ?? []), { language: typeof parsed.language === "string" ? parsed.language : undefined, code: String(parsed.code) }]
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, codeSnippets: streamedCodeSnippets } : msg))
          } else if (currentEvent === "codeResult" && parsed.output) {
            streamedExecutionOutputs = [...(streamedExecutionOutputs ?? []), { outcome: typeof parsed.outcome === "string" ? parsed.outcome : undefined, output: String(parsed.output) }]
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, executionOutputs: streamedExecutionOutputs } : msg))
          } else if (currentEvent === "mermaid" && Array.isArray(parsed.blocks)) {
            streamedMermaidBlocks = parsed.blocks
            const updatedContent = applyMermaidReplacements(streamedContent, streamedMermaidBlocks)
            if (updatedContent !== streamedContent) streamedContent = updatedContent
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: streamedContent, mermaidBlocks: streamedMermaidBlocks, isComplete: false } : msg))
          } else if (currentEvent === "youtubeResults") {
            const normalizedVideos = normalizeVideoResults(parsed?.videos ?? parsed)
            if (normalizedVideos && normalizedVideos.length > 0) {
              streamedVideos = normalizedVideos
              setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, videos: normalizedVideos } : msg))
            }
          } else if (currentEvent === "graph" && parsed.graph) {
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, graphData: parsed.graph } : msg))
          } else if (currentEvent === "excalidraw" && parsed.excalidrawData && Array.isArray(parsed.excalidrawData)) {
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, excalidrawData: parsed.excalidrawData } : msg))
          } else if (currentEvent === "finish" && parsed.finishReason) {
            setAssistantStatuses((prev) => ({ ...prev, responding: "complete" }))
          } else if (currentEvent === "error" && parsed.error) {
            throw new Error(parsed.error)
          }
        } catch (parseError) {
          if (data !== "[DONE]") console.warn("Failed to parse SSE data:", data, parseError)
        }
      }

      if (!reader) throw new Error("No response body reader available")

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim().length > 0) {
            for (const line of buffer.split("\n")) { if (line) processSseLine(line) }
            buffer = ""
          }
          if (updateTimer) {
            clearTimeout(updateTimer)
            setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? { ...msg, content: streamedContent, createdAt: new Date() } : msg))
          }
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) processSseLine(line)
      }

      const finalContent = streamedContent || "I couldn't fetch the details. Please try again later."
      setMessages((prev) => prev.map((msg) => msg.id === assistantMessageId ? {
        ...msg, content: finalContent, sources: streamedSources, toolEvidence: streamedEvidence, chartUrl: msg.chartUrl, chartUrls: msg.chartUrls ?? [],
        images: streamedImages.length > 0 ? streamedImages : msg.images, videos: streamedVideos.length > 0 ? streamedVideos : msg.videos,
        codeSnippets: streamedCodeSnippets, executionOutputs: streamedExecutionOutputs, mermaidBlocks: streamedMermaidBlocks, createdAt: new Date(), isComplete: true,
      } : msg))

      // Copilot replies are grounded in tool evidence; no post-hoc chart
      // generation is performed (legacy ungrounded chart call removed).
    } catch (error) {
      if (error.name === "AbortError") return
      console.error("Error in streaming:", error)
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Sorry, I encountered an error while processing your request. Please try again.", createdAt: new Date() }])
      setAssistantStatuses(createInitialAssistantStatuses())
    }
  }

  const handleSubmit = (event, options) => {
    event?.preventDefault?.()
    if (!input && !options?.experimental_attachments?.length) return
    const newMessage = {
      id: crypto.randomUUID(), role: "user", content: input || "(sent with attachments)", createdAt: new Date(),
      experimental_attachments: options?.experimental_attachments
        ? Array.from(options.experimental_attachments).map((f) => ({ name: f.name, contentType: f.type, url: "data:;base64," }))
        : undefined,
    }
    setMessages((prev) => [...prev, newMessage])
    setInput("")
    setIsGenerating(true)
    simulateAssistant(newMessage.content, options?.experimental_attachments).finally(() => {
      setIsGenerating(false)
      abortControllerRef.current = null
    })
  }

  const onRateResponse = (messageId, rating) => {
    toast.success(rating === "thumbs-up" ? "Marked response as helpful" : "Marked response as not helpful", { description: "Thanks for your feedback!" })
  }

  const transcribeAudio = async (audioBlob) => {
    try {
      const formData = new FormData()
      formData.append("audio", audioBlob, "recording.wav")
      const response = await fetch(`${SERVER_URL_1}/api/speech/transcribe`, { method: "POST", body: formData })
      if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.error || "Failed to transcribe audio") }
      const data = await response.json()
      if (data.success && data.text) return data.text
      throw new Error("No transcription returned")
    } catch (error) {
      console.error("Transcription error:", error)
      throw error
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');

        .chat-root {
          --accent: #00e87a;
          --accent-rgb: 0, 232, 122;
          --danger-rgb: 239, 68, 68;
          --accent-glow: rgba(var(--accent-rgb), 0.35);
          --accent-dim: rgba(var(--accent-rgb), 0.12);
          --glass-bg: rgba(255, 255, 255, 0.06);
          --glass-border: rgba(255, 255, 255, 0.1);
          --glass-blur: blur(24px);
          --panel-bg: rgba(12, 12, 20, 0.72);
          --panel-border: rgba(255,255,255,0.08);
          --text-primary: rgba(240, 235, 228, 0.95);
          --text-secondary: rgba(200, 190, 178, 0.6);
          --font-display: 'Playfair Display', Georgia, serif;
          --font-body: 'Plus Jakarta Sans', sans-serif;
          --font-mono: 'IBM Plex Mono', monospace;
        }

        .chat-root * { font-family: var(--font-body); box-sizing: border-box; }

        .chat-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }
        .chat-bg-video {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0.2;
          filter: saturate(0.9);
        }
        .chat-bg-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.5;
        }
        .chat-bg-grid {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(var(--accent-rgb),0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(var(--accent-rgb),0.045) 1px, transparent 1px);
          background-size: 90px 90px;
          opacity: 0.35;
        }
        .chat-bg-vignette {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 1200px 700px at 50% 35%, rgba(var(--accent-rgb),0.08) 0%, rgba(5,5,12,0.9) 65%);
        }
        .chat-bg-glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 800px 500px at 50% 20%, rgba(var(--accent-rgb),0.1), transparent 70%);
        }
        .chat-bg-topfade,
        .chat-bg-bottomfade {
          position: absolute;
          left: 0;
          right: 0;
          height: 110px;
        }
        .chat-bg-topfade { top: 0; background: linear-gradient(to bottom, rgba(5,5,10,0.95), transparent); }
        .chat-bg-bottomfade { bottom: 0; background: linear-gradient(to top, rgba(5,5,10,0.95), transparent); }

        /* Scanline overlay */
        .chat-root::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.03) 2px,
            rgba(0,0,0,0.03) 4px
          );
        }

        /* Glowing corner brackets */
        .corner-bracket {
          position: absolute;
          width: 14px;
          height: 14px;
          border-color: var(--accent);
          border-style: solid;
          opacity: 0.5;
        }
        .corner-bracket.tl { top: 0; left: 0; border-width: 1.5px 0 0 1.5px; }
        .corner-bracket.tr { top: 0; right: 0; border-width: 1.5px 1.5px 0 0; }
        .corner-bracket.bl { bottom: 0; left: 0; border-width: 0 0 1.5px 1.5px; }
        .corner-bracket.br { bottom: 0; right: 0; border-width: 0 1.5px 1.5px 0; }

        .hud-header {
          background: rgba(8, 8, 14, 0.78);
          border-bottom: 1px solid rgba(var(--accent-rgb), 0.18);
          backdrop-filter: blur(32px) saturate(1.4);
          -webkit-backdrop-filter: blur(32px) saturate(1.4);
        }

        .hud-logo-text {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
          letter-spacing: 0.04em;
          color: var(--text-primary);
        }

        .hud-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          height: 32px;
          padding: 0 14px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.04em;
          color: rgba(200, 190, 178, 0.7);
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          overflow: hidden;
          white-space: nowrap;
          text-decoration: none;
        }
        .hud-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(var(--accent-rgb),0.15), transparent);
          opacity: 0;
          transition: opacity 0.2s;
        }
        .hud-btn:hover {
          color: #c8f0e0;
          border-color: rgba(var(--accent-rgb), 0.35);
          box-shadow: 0 0 12px rgba(var(--accent-rgb), 0.15), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .hud-btn:hover::after { opacity: 1; }

        .hud-profile-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          height: 36px;
          padding: 0 12px 0 6px;
          font-family: var(--font-mono);
          font-size: 0.75rem;
          font-weight: 500;
          color: rgba(200, 190, 178, 0.7);
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .hud-profile-btn:hover {
          color: #c8f0e0;
          border-color: rgba(var(--accent-rgb), 0.35);
          box-shadow: 0 0 16px rgba(var(--accent-rgb), 0.2);
        }

        .hud-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--accent), #1a5c3d);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-size: 0.7rem;
          font-weight: 700;
          color: white;
          border: 1px solid rgba(var(--accent-rgb), 0.5);
          flex-shrink: 0;
        }

        /* Dropdown panel */
        .hud-dropdown {
          position: absolute;
          z-index: 50;
          top: calc(100% + 10px);
          min-width: 300px;
          background: rgba(10, 10, 18, 0.94);
          border: 1px solid rgba(var(--accent-rgb), 0.2);
          border-radius: 12px;
          padding: 12px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 40px rgba(var(--accent-rgb),0.08);
          backdrop-filter: blur(32px);
          -webkit-backdrop-filter: blur(32px);
        }

        .hud-dropdown-header {
          padding: 10px 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          margin-bottom: 10px;
        }

        .hud-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          font-size: 0.78rem;
          color: rgba(200, 190, 178, 0.75);
          background: transparent;
          border: none;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }
        .hud-dropdown-item:hover {
          background: rgba(var(--accent-rgb), 0.12);
          color: #c8f0e0;
        }

        .conv-item {
          display: flex;
          align-items: center;
          gap: 6px;
          border-radius: 8px;
          transition: background 0.15s;
        }
        .conv-item:hover { background: rgba(255,255,255,0.04); }
        .conv-item.active { background: rgba(var(--accent-rgb), 0.1); }

        .conv-btn {
          flex: 1;
          min-width: 0;
          padding: 8px 10px;
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          border-radius: 8px;
        }

        .conv-title {
          font-size: 0.75rem;
          font-weight: 500;
          color: rgba(220, 210, 200, 0.85);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .conv-date {
          font-size: 0.65rem;
          color: rgba(180, 170, 160, 0.45);
          margin-top: 2px;
        }

        .conv-delete {
          padding: 5px;
          background: transparent;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          color: rgba(180,170,160,0.35);
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .conv-delete:hover { background: rgba(229,75,79,0.12); color: #e54b4f; }

        .search-input {
          width: 100%;
          height: 36px;
          padding: 0 10px 0 32px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          font-size: 0.75rem;
          color: rgba(220,210,200,0.9);
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input::placeholder { color: rgba(180,170,160,0.35); }
        .search-input:focus { border-color: rgba(var(--accent-rgb),0.4); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),0.08); }

        /* Welcome screen */
        .welcome-panel {
          background: rgba(10, 10, 18, 0.72);
          border: 1px solid rgba(var(--accent-rgb), 0.15);
          border-radius: 20px;
          backdrop-filter: blur(40px) saturate(1.3);
          -webkit-backdrop-filter: blur(40px) saturate(1.3);
          box-shadow: 0 40px 100px rgba(0,0,0,0.5), 0 0 60px rgba(var(--accent-rgb),0.06) inset;
          padding: 48px 40px 40px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .welcome-panel::before {
          content: '';
          position: absolute;
          top: -60px;
          left: 50%;
          transform: translateX(-50%);
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(var(--accent-rgb),0.12), transparent 70%);
          pointer-events: none;
        }

        .welcome-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 5px 14px;
          background: rgba(var(--accent-rgb),0.1);
          border: 1px solid rgba(var(--accent-rgb),0.25);
          border-radius: 20px;
          font-family: var(--font-mono);
          font-size: 0.6rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(180, 220, 200, 0.8);
          margin-bottom: 28px;
        }

        .welcome-greeting {
          font-family: var(--font-display);
          font-size: clamp(2rem, 5vw, 2.8rem);
          font-weight: 700;
          line-height: 1.1;
          margin-bottom: 16px;
          color: var(--text-primary);
        }
        .welcome-greeting .name-highlight {
          background: linear-gradient(135deg, #a8e8d0, var(--accent), #1a5c3d);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-style: italic;
        }

        .welcome-sub {
          font-size: 0.9rem;
          color: var(--text-secondary);
          max-width: 380px;
          margin: 0 auto 32px;
          line-height: 1.6;
        }

        .welcome-pills {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
        }
        .welcome-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 20px;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: rgba(200,190,178,0.55);
          transition: all 0.2s;
        }
        .welcome-pill:hover {
          border-color: rgba(var(--accent-rgb),0.3);
          color: rgba(200,230,215,0.9);
          background: rgba(var(--accent-rgb),0.07);
        }
        .welcome-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 6px rgba(var(--accent-rgb),0.6);
          flex-shrink: 0;
        }

        /* Messages panel */
        .messages-panel {
          background: rgba(8, 8, 16, 0.68);
          border: 1px solid rgba(var(--accent-rgb),0.12);
          border-radius: 16px;
          padding: 24px;
          backdrop-filter: blur(32px);
          -webkit-backdrop-filter: blur(32px);
          box-shadow: 0 30px 80px rgba(0,0,0,0.4);
          position: relative;
        }

        /* Footer input area */
        .hud-footer {
          background: rgba(8, 8, 14, 0.85);
          border-top: 1px solid rgba(var(--accent-rgb),0.15);
          backdrop-filter: blur(32px) saturate(1.4);
          -webkit-backdrop-filter: blur(32px) saturate(1.4);
        }
        .hud-footer::before {
          content: '';
          position: absolute;
          inset-x-0;
          top: -1px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.4), transparent);
        }

        /* Mobile menu */
        .mobile-menu-panel {
          background: rgba(8, 8, 16, 0.95);
          border: 1px solid rgba(var(--accent-rgb),0.2);
          border-radius: 16px;
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.7);
        }

        /* Scrollbar */
        .hud-scroll::-webkit-scrollbar { width: 4px; }
        .hud-scroll::-webkit-scrollbar-track { background: transparent; }
        .hud-scroll::-webkit-scrollbar-thumb { background: rgba(var(--accent-rgb),0.25); border-radius: 2px; }
        .hud-scroll::-webkit-scrollbar-thumb:hover { background: rgba(var(--accent-rgb),0.4); }

        /* Pulse dot */
        @keyframes pulse-dot { 0%, 100% { opacity: 1; box-shadow: 0 0 6px rgba(var(--accent-rgb),0.8); } 50% { opacity: 0.4; box-shadow: 0 0 2px rgba(var(--accent-rgb),0.2); } }
        .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }

        /* Spin animation */
        @keyframes spin-slow { from { transform: translateX(-50%) translateY(-50%) rotate(0deg); } to { transform: translateX(-50%) translateY(-50%) rotate(360deg); } }
        .spin-slow { animation: spin-slow 18s linear infinite; }

        /* Horizontal divider line */
        .hud-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.25), transparent);
          margin: 10px 0;
        }
      `}</style>

      <div
        className="chat-root relative flex flex-col overflow-hidden"
        style={{ minHeight: viewportHeight, color: "var(--text-primary)" }}
      >
        {/* ── Hero-style background ── */}
        <div aria-hidden="true" className="chat-bg" style={{ height: viewportHeight }}>
          <video
            autoPlay
            muted
            loop
            playsInline
            className="chat-bg-video"
          >
            <source src="/bg-video-graphP.webm" type="video/webm" />
          </video>
          <HeroBackdropCanvas />
          <div className="chat-bg-glow" />
          <div className="chat-bg-grid" />
          <div className="chat-bg-vignette" />
          <div className="chat-bg-topfade" />
          <div className="chat-bg-bottomfade" />
        </div>

        {/* ── Header ── */}
        <header
          ref={headerRef}
          className="hud-header fixed inset-x-0 top-0 z-20 px-4 sm:px-6"
          style={{ paddingTop: "calc(14px + env(safe-area-inset-top, 0px))", paddingBottom: "14px" }}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">

            {/* Left: back + logo */}
            <div className="flex items-center gap-3">
              <Image src="/main-logo.png" alt="Arth Saathi logo" width={32} height={32} style={{ borderRadius: 8, border: "1px solid rgba(var(--accent-rgb),0.3)" }} />
              <span className="hud-logo-text">Arth Saathi <span style={{ color: "var(--accent)" }}></span></span>
            </div>

            {/* Desktop center actions */}
            <div className="hidden md:flex items-center gap-2">
              <button type="button" className="hud-btn" onClick={startNewChat}>
                <Plus style={{ width: 13, height: 13 }} /> New chat
              </button>

              {/* Investigation mode selector */}
              <div
                style={{
                  height: 32, paddingLeft: 10, paddingRight: 10,
                  background: "rgba(var(--accent-rgb),0.08)",
                  border: "1px solid rgba(var(--accent-rgb),0.25)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)", fontSize: "0.72rem",
                  color: "rgba(var(--accent-rgb),1)",
                  display: "inline-flex", alignItems: "center",
                }}
              >
                {user?.role === "analyst" || user?.role === "admin" ? "Federated Risk Copilot — Analyst" : "Financial Risk Companion — Citizen"}
              </div>
              {activeModeBadge && (
                <span style={{
                  height: 22, padding: "0 8px", borderRadius: 6,
                  background: "rgba(var(--accent-rgb),0.12)",
                  border: "1px solid rgba(var(--accent-rgb),0.3)",
                  fontFamily: "var(--font-mono)", fontSize: "0.62rem",
                  color: "rgba(var(--accent-rgb),0.9)",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  ● {activeModeBadge}
                </span>
              )}

              {/* History dropdown */}
              <div className="history-dropdown" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="hud-btn"
                  onClick={() => {
                    setIsProfileOpen(false)
                    setIsHistoryOpen((v) => {
                      const next = !v
                      if (next && !isHistoryLoading && conversations.length === 0) void loadConversations()
                      if (!next) setHistoryQuery("")
                      return next
                    })
                  }}
                >
                  <Search style={{ width: 13, height: 13 }} /> History
                </button>

                {isHistoryOpen && (
                  <div className="hud-dropdown" style={{ left: "50%", transform: "translateX(-50%)", width: 380 }}>
                    <div className="corner-bracket tl" /><div className="corner-bracket tr" />
                    <div className="corner-bracket bl" /><div className="corner-bracket br" />
                    <div className="hud-dropdown-header">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div>
                          <p style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>Search chats</p>
                          <p style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>Browse and reopen conversations</p>
                        </div>
                        <button type="button" className="hud-btn" style={{ height: 26, padding: "0 10px", fontSize: "0.7rem" }} onClick={startNewChat}>
                          <Plus style={{ width: 11, height: 11 }} /> New
                        </button>
                      </div>
                      <div style={{ position: "relative" }}>
                        <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "rgba(180,170,160,0.4)", pointerEvents: "none" }} />
                        <input
                          type="text"
                          value={historyQuery}
                          onChange={(e) => setHistoryQuery(e.target.value)}
                          placeholder="Search conversations…"
                          className="search-input"
                        />
                      </div>
                    </div>

                    <div className="hud-scroll" style={{ maxHeight: 280, overflowY: "auto", overflowX: "hidden" }}>
                      {isHistoryLoading ? (
                        <p style={{ padding: "20px 12px", textAlign: "center", fontSize: "0.75rem", color: "var(--text-secondary)" }}>Loading…</p>
                      ) : conversations.length === 0 ? (
                        <p style={{ padding: "20px 12px", textAlign: "center", fontSize: "0.75rem", color: "var(--text-secondary)" }}>No conversations yet</p>
                      ) : filteredHistory.length === 0 ? (
                        <p style={{ padding: "20px 12px", textAlign: "center", fontSize: "0.75rem", color: "var(--text-secondary)" }}>No results for "{historyQuery}"</p>
                      ) : (
                        <ul style={{ padding: "4px 0", listStyle: "none", margin: 0 }}>
                          {filteredHistory.map((conv) => {
                            const isActive = currentConversationId === conv.id
                            const ts = formatConversationDate(conv.updated_at ?? conv.created_at)
                            return (
                              <li key={conv.id}>
                                <div className={`conv-item${isActive ? " active" : ""}`} style={{ padding: "2px 4px" }}>
                                  <button className="conv-btn" onClick={() => handleConversationSelect(conv.id)} type="button">
                                    <div className="conv-title">{conv.title || `Chat ${conv.id.slice(0, 6)}`}</div>
                                    {ts && <div className="conv-date">{ts}</div>}
                                    {loadingConversationId === conv.id && <div style={{ fontSize: "0.65rem", color: "var(--accent)", marginTop: 2 }}>Loading…</div>}
                                  </button>
                                  <button className="conv-delete" onClick={(e) => handleDeleteConversation(conv.id, e)} title="Delete" type="button">
                                    <Trash2 style={{ width: 13, height: 13 }} />
                                  </button>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button type="button" className="hud-btn" onClick={() => toast("Library is coming soon")}>
                <BookOpen style={{ width: 13, height: 13 }} /> Library
              </button>

              <Link href="/analyst/graph" className="hud-btn">
                <Network style={{ width: 13, height: 13 }} /> Graph
              </Link>

              <button type="button" className="hud-btn" onClick={() => setIsFeedbackOpen(true)}>
                <MessageCircle style={{ width: 13, height: 13 }} /> Feedback
              </button>
            </div>

            {/* Desktop right: profile / auth */}
            <div className="hidden md:flex items-center gap-2">
              {user ? (
                <div className="profile-dropdown" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="hud-profile-btn"
                    onClick={() => { setIsHistoryOpen(false); setIsProfileOpen((v) => !v) }}
                  >
                    {userAvatar
                      ? <img src={userAvatar} alt={displayName} style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(var(--accent-rgb),0.4)" }} referrerPolicy="no-referrer" />
                      : <div className="hud-avatar">{userInitial}</div>
                    }
                    <span style={{ fontSize: "0.75rem", fontWeight: 500 }}>{displayName}</span>
                    <ChevronDown style={{ width: 13, height: 13, transition: "transform 0.3s", transform: isProfileOpen ? "rotate(180deg)" : "rotate(0deg)" }} />
                  </button>

                  {isProfileOpen && (
                    <div className="hud-dropdown" style={{ right: 0, width: 240 }}>
                      <div className="corner-bracket tl" /><div className="corner-bracket tr" />
                      <div className="corner-bracket bl" /><div className="corner-bracket br" />
                      <div className="hud-dropdown-header" style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {userAvatar
                          ? <img src={userAvatar} alt={displayName} style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "1px solid rgba(var(--accent-rgb),0.4)", flexShrink: 0 }} referrerPolicy="no-referrer" />
                          : <div className="hud-avatar" style={{ width: 44, height: 44, fontSize: "1rem" }}>{userInitial}</div>
                        }
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                          {displayEmail && <div style={{ fontSize: "0.68rem", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayEmail}</div>}
                        </div>
                      </div>
                      <div className="hud-divider" />
                      <button type="button" className="hud-dropdown-item" onClick={() => { setIsProfileOpen(false); logout() }}>
                        <LogOut style={{ width: 13, height: 13 }} /> Logout
                      </button>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Theme</span>
                        <ThemeToggle />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <Link href="/login" className="hud-btn">Log in</Link>
                  <Link href="/signup" className="hud-btn">Sign up</Link>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ── Main Content ── */}
        <div
          className="flex-1 overflow-hidden"
          style={{
            position: "relative",
            zIndex: 2,
            minHeight: viewportHeight,
            paddingTop: messages.length > 0 ? `${layoutHeights.header}px` : 0,
            paddingBottom: messages.length > 0 ? `${layoutHeights.footer}px` : 0,
          }}
        >
          <div className={`h-full ${messages.length > 0 ? "hud-scroll overflow-y-auto" : "overflow-hidden"}`}>
            <div className={`min-h-full px-4 sm:px-6 ${messages.length === 0 ? "" : "py-6 sm:py-8"}`}>
              <div className="mx-auto w-full max-w-4xl">
                {messages.length === 0 ? (
                  <div
                    className="fixed inset-x-0 grid place-items-center px-4 sm:px-6"
                    style={{ top: layoutHeights.header, bottom: layoutHeights.footer }}
                  >
                    <div className="welcome-panel w-full max-w-2xl mx-auto">
                      <div className="corner-bracket tl" /><div className="corner-bracket tr" />
                      <div className="corner-bracket bl" /><div className="corner-bracket br" />

                      {/* Spinning conic glow */}
                      <div style={{ position: "absolute", top: "50%", left: "50%", width: "28rem", height: "28rem", pointerEvents: "none", zIndex: 0 }}
                        className="spin-slow"
                      >
                        <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(var(--accent-rgb),0.15), transparent, rgba(var(--accent-rgb),0.1), transparent)", filter: "blur(20px)", opacity: 0.4 }} />
                      </div>

                      <div style={{ position: "relative", zIndex: 1 }}>
                        <div className="welcome-badge">
                          <span className="pulse-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                          Privacy-preserving risk copilot online
                        </div>

                        <h2 className="welcome-greeting">
                          {salutation},
                          <br />
                          <span className="name-highlight">{firstName}</span>
                        </h2>

                        <p className="welcome-sub">
                          Grounded assistance for federated model evidence, privacy trade-offs, pseudonymous graph intelligence, and customer rights.
                        </p>

                        <div className="welcome-pills">
                          {["Run evidence & metrics", "Pseudonymous graph context", "Consent-aware explanations"].map((label) => (
                            <div key={label} className="welcome-pill">
                              <span className="welcome-pill-dot" />
                              {label}
                            </div>
                          ))}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                          {defaultSuggestions(investigationMode).slice(0, 3).map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                              style={{
                                textAlign: "left", fontSize: 13, padding: "10px 14px",
                                borderRadius: 10, border: "1px solid rgba(var(--accent-rgb),0.25)",
                                background: "rgba(var(--accent-rgb),0.06)", color: "var(--foreground)",
                                cursor: "pointer",
                              }}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full space-y-6">
                    <div className="messages-panel">
                      <div className="corner-bracket tl" /><div className="corner-bracket tr" />
                      <div className="corner-bracket bl" /><div className="corner-bracket br" />
                      <MessageList
                        messages={messages}
                        isTyping={isGenerating}
                        typingStatuses={assistantStatuses}
                        messageOptions={(message) => {
                          if (message.role === "user") return {}
                          return {
                            actions: onRateResponse ? (
                              <>
                                <div style={{ borderRight: "1px solid rgba(255,255,255,0.08)", paddingRight: 6, display: "flex", alignItems: "center", gap: 4 }}>
                                  <TTSButton content={message.content} />
                                  <CopyButton content={message.content} copyMessage="Copied response to clipboard!" />
                                </div>
                                <button type="button" className="hud-btn" style={{ width: 26, height: 26, padding: 0, justifyContent: "center", borderRadius: "50%" }}
                                  onClick={() => onRateResponse(message.id, "thumbs-up")}>
                                  <ThumbsUp style={{ width: 13, height: 13 }} />
                                </button>
                                <button type="button" className="hud-btn" style={{ width: 26, height: 26, padding: 0, justifyContent: "center", borderRadius: "50%" }}
                                  onClick={() => onRateResponse(message.id, "thumbs-down")}>
                                  <ThumbsDown style={{ width: 13, height: 13 }} />
                                </button>
                              </>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <TTSButton content={message.content} />
                                <CopyButton content={message.content} copyMessage="Copied response to clipboard!" />
                              </div>
                            ),
                            isComplete: message.isComplete,
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Input Footer ── */}
        <div
          ref={footerRef}
          className="hud-footer fixed bottom-0 left-0 right-0"
          style={{ zIndex: 30 }}
        >
          {/* Top glow line */}
          <div style={{ position: "absolute", inset: "0 0 auto", height: 1, background: "linear-gradient(90deg, transparent, rgba(var(--accent-rgb),0.45), transparent)", pointerEvents: "none" }} />

          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6" style={{ position: "relative" }}>
            {/* Ambient glow behind input */}
            <div style={{ position: "absolute", insetX: "10%", top: 0, height: 60, background: "radial-gradient(ellipse at 50% 0%, rgba(var(--accent-rgb),0.18), transparent 70%)", pointerEvents: "none", filter: "blur(12px)" }} />
            <ChatForm isPending={isGenerating} handleSubmit={handleSubmit}>
              {({ files, setFiles }) => (
                <div style={{ position: "relative" }}>
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <SuggestionDropdown
                      suggestions={filteredSuggestions}
                      onSelect={handleSuggestionSelect}
                      inputValue={input}
                      className="w-full"
                    />
                  )}
                  <MessageInput
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={(e) => { if (e.key === "Escape") setShowSuggestions(false) }}
                    stop={stop}
                    isGenerating={isGenerating}
                    transcribeAudio={transcribeAudio}
                    inputRef={inputRef}
                    allowAttachments
                    files={files}
                    setFiles={setFiles}
                    includeYouTube={includeYouTube}
                    onToggleYouTube={(next) => setIncludeYouTube(next)}
                    includeImageSearch={includeImageSearch}
                    onToggleImageSearch={(next) => setIncludeImageSearch(next)}
                  />
                </div>
              )}
            </ChatForm>
          </div>
        </div>

        <FeedbackDialog
          open={isFeedbackOpen}
          onOpenChange={setIsFeedbackOpen}
          conversationId={currentConversationId}
          userEmail={displayEmail}
          userId={user ? user.email : null}
        />
      </div>
    </>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading chat…</div>}>
      <ChatPageContent />
    </Suspense>
  )
}
