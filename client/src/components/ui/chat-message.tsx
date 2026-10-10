"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "framer-motion"
import { Ban, ChevronRight, Code2, Download, ExternalLink, Facebook, Globe, Image as ImageIcon, Instagram, Linkedin, Loader2, Network, ShieldCheck, Sparkles, Terminal, Twitter, Youtube } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { FilePreview } from "@/components/ui/file-preview"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ExcalidrawViewer } from "@/components/ui/excalidraw-viewer"
import { MlPayloadGraphViewer } from "@/components/ui/ml-payload-graph-viewer"



function toSentenceCase(text: string): string {
  if (typeof text !== "string" || text.trim().length === 0) {
    return text ?? ""
  }
  const trimmed = text.trim()
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}


const chatBubbleVariants = cva(
  "group/message relative break-words transition-all duration-300",
  {
    variants: {
      isUser: {
        true: "max-w-[85%] sm:max-w-[70%] rounded-2xl px-5 py-3.5 text-slate-900 glass-morphism hover:bg-white/10 dark:text-slate-100 dark:hover:bg-white/5",
        false: "w-full max-w-full px-0 py-0 text-slate-900 dark:text-slate-100",
      },
      animation: {
        none: "",
        slide: "duration-300 animate-in fade-in-0",
        scale: "duration-500 animate-in fade-in-0 zoom-in-95",
        fade: "duration-700 animate-in fade-in-0",
      },
    },
    compoundVariants: [
      {
        isUser: true,
        animation: "slide",
        class: "slide-in-from-right-4",
      },
      {
        isUser: false,
        animation: "slide",
        class: "slide-in-from-left-4",
      },
      {
        isUser: true,
        animation: "scale",
        class: "origin-bottom-right",
      },
      {
        isUser: false,
        animation: "scale",
        class: "origin-bottom-left",
      },
    ],
  }
)

const BlinkingCursor = () => (
  <motion.span
    initial={{ opacity: 0 }}
    animate={{ opacity: [0, 1, 0] }}
    transition={{
      duration: 0.8,
      repeat: Infinity,
      ease: "linear",
    }}
    className="inline-block h-4 w-1.5 translate-y-0.5 rounded-full bg-primary/60"
  />
)

type Animation = VariantProps<typeof chatBubbleVariants>["animation"]

type PatternResult = {
  pattern: string
  risk_score: number
  threshold: number
  above_threshold: boolean
  decision: "not_suspicious" | "likely_suspicious" | "highly_suspicious"
  top_features: string[]
}

type ClassifyResponse = {
  best_pattern: string
  best_risk_score: number
  best_threshold: number
  best_above_threshold: boolean
  best_decision: PatternResult["decision"]
  all_results: PatternResult[]
  model?: string
  inference_ms?: number
}

function isClassifyResponse(d: unknown): d is ClassifyResponse {
  return (
    typeof d === "object" &&
    d !== null &&
    "best_pattern" in d &&
    "all_results" in d &&
    Array.isArray((d as ClassifyResponse).all_results)
  )
}

const DECISION_STYLE: Record<PatternResult["decision"], { label: string; className: string }> = {
  not_suspicious: { label: "Not suspicious", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  likely_suspicious: { label: "Likely suspicious", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  highly_suspicious: { label: "Highly suspicious", className: "bg-destructive/15 text-destructive border-destructive/30" },
}

function ClassificationResponseBlock({ data }: { data: unknown }) {
  if (data == null) return null
  const isError = typeof data === "object" && data !== null && "error" in data
  const errorMsg = isError && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null

  if (isError && errorMsg) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-4 rounded-xl border border-destructive/50 bg-destructive/5 overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm font-semibold text-foreground">Classification error</span>
        </div>
        <div className="p-3">
          <p className="text-sm text-destructive">{errorMsg}</p>
        </div>
      </motion.div>
    )
  }

  if (!isClassifyResponse(data)) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mt-4 rounded-xl border border-border/50 bg-muted/30 overflow-hidden"
      >
        <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">Classification result</span>
        </div>
        <div className="p-3 min-h-[60px]">
          <pre className="text-xs font-mono text-foreground/90 whitespace-pre-wrap break-words overflow-x-auto max-h-[320px] overflow-y-auto rounded-lg bg-background/60 p-3 border border-border/40">
            {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </motion.div>
    )
  }

  const res = data as ClassifyResponse
  const bestStyle = DECISION_STYLE[res.best_decision] ?? DECISION_STYLE.not_suspicious
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-4 rounded-xl border border-border/50 bg-gradient-to-b from-muted/40 to-muted/20 overflow-hidden shadow-sm"
    >
      <div className="px-4 py-2.5 border-b border-border/50 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">Pattern classification (score 0–1, threshold 0.75)</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Best match</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold text-foreground">{res.best_pattern}</span>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", bestStyle.className)}>
              {bestStyle.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm items-baseline">
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Score</span>
              <span className="font-bold tabular-nums text-foreground">{res.best_risk_score.toFixed(2)} / 1</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Threshold</span>
              <span className="font-semibold tabular-nums text-foreground">{res.best_threshold}</span>
            </div>
            {res.best_above_threshold && (
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Above threshold</span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">All patterns</p>
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {res.all_results.map((r, i) => {
              const style = DECISION_STYLE[r.decision] ?? DECISION_STYLE.not_suspicious
              const isBest = r.pattern === res.best_pattern
              return (
                <div
                  key={`${r.pattern}-${i}`}
                  className={cn(
                    "rounded-lg border p-3 space-y-2 transition-colors",
                    isBest ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/60"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{r.pattern}</span>
                    {isBest && <span className="text-[10px] font-medium text-primary uppercase">Best</span>}
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", style.className)}>
                      {style.label}
                    </span>
                    <span className="ml-auto font-mono text-sm tabular-nums text-foreground">{r.risk_score.toFixed(2)} / 1</span>
                  </div>
                  {r.top_features && r.top_features.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.top_features.slice(0, 5).map((f, j) => (
                        <span
                          key={`${f}-${j}`}
                          className="inline-flex items-center rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {f}
                        </span>
                      ))}
                      {r.top_features.length > 5 && (
                        <span className="text-[10px] text-muted-foreground">+{r.top_features.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

interface Attachment {
  name?: string
  contentType?: string
  url: string
}

interface PartialToolCall {
  state: "partial-call"
  toolName: string
}

interface ToolCall {
  state: "call"
  toolName: string
}

interface ToolResult {
  state: "result"
  toolName: string
  result: {
    __cancelled?: boolean
    [key: string]: unknown
  }
}

type ToolInvocation = PartialToolCall | ToolCall | ToolResult

interface ReasoningPart {
  type: "reasoning"
  reasoning: string
}

interface ToolInvocationPart {
  type: "tool-invocation"
  toolInvocation: ToolInvocation
}

interface TextPart {
  type: "text"
  text: string
}

interface SourcePart {
  type: "source"
  source?: unknown
}

interface FilePart {
  type: "file"
  mimeType: string
  data: string
}

interface StepStartPart {
  type: "step-start"
}

export interface CodeSnippet {
  language?: string
  code: string
}

export interface ExecutionOutput {
  outcome?: string
  output: string
}

export interface MermaidBlockUpdate {
  index: number
  status?: 'valid' | 'corrected' | 'failed'
  original?: string
  replacement?: string
  error?: string
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolInvocationPart
  | SourcePart
  | FilePart
  | StepStartPart

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: Date
  experimental_attachments?: Attachment[]
  toolInvocations?: ToolInvocation[]
  images?: ImageResult[] | null
  parts?: MessagePart[]
  sources?: Array<string | { url: string; title?: string }>
  chartUrl?: string | null
  chartUrls?: string[] | null
  videos?: Array<{
    videoId?: string
    title?: string
    description?: string
    channelTitle?: string
    url?: string
    thumbnails?: {
      default?: { url?: string }
      medium?: { url?: string }
      high?: { url?: string }
    }
  }> | null
  socialProfiles?: Array<{
    platform: string
    results: Array<{
      handle?: string
      url?: string
      title?: string
      snippet?: string
    }>
  }> | null
  socialReason?: string | null
  // Optional title for assistant responses, typically the user's prompt.
  promptTitle?: string
  isComplete?: boolean
  codeSnippets?: CodeSnippet[]
  executionOutputs?: ExecutionOutput[]
  mermaidBlocks?: MermaidBlockUpdate[]
  excalidrawData?: Array<{
    type: 'excalidraw'
    version: number
    source: string
    elements: Array<Record<string, unknown>>
    appState: {
      gridSize: number | null
      viewBackgroundColor: string
    }
    files: Record<string, unknown>
  }> | null
  /** ML schema payload (P1–P6) from parallel ml-generate; rendered as nodes/edges graph */
  mlPayload?: Record<string, unknown> | null
  mlPattern?: string | null
  mlSampleId?: string | null
  /** Classifier result: best pattern and scores 0–10 (threshold 0.75) */
  classificationResponse?: unknown
  /** Authorized copilot tool results grounding the response */
  toolEvidence?: Array<{
    tool?: string
    label?: string
    ok?: boolean
    summary?: string
    evidence_id?: string
  }> | null
  /** Neo4j graph data streamed via the `graph` SSE event */
  graphData?:
    | {
        kind: "neighborhood"
        center: string
        neighbors: Array<{
          id: string
          score?: number | null
          band?: string | null
          n_tx?: number | null
          total_amt?: number | null
        }>
      }
    | {
        kind: "ring"
        label?: string
        nodes: Array<{ id: string; score?: number | null; band?: string | null }>
        edges: Array<{ source: string; target: string; n_tx?: number | null }>
      }
    | null
}

export interface ImageResult {
  title: string | null
  imageUrl: string | null
  pageUrl: string | null
  thumbnailUrl?: string | null
}

export interface ChatMessageProps extends Message {
  showTimeStamp?: boolean
  animation?: Animation
  actions?: React.ReactNode
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  createdAt,
  chartUrl,
  chartUrls,
  images,
  videos,
  socialProfiles,
  socialReason,
  showTimeStamp = false,
  animation = "scale",
  actions,
  experimental_attachments,
  toolInvocations,
  parts,
  sources,
  toolEvidence,
  promptTitle,
  isComplete,
  codeSnippets,
  executionOutputs,
  excalidrawData,
  mlPayload,
  mlPattern,
  mlSampleId,
  classificationResponse,
  graphData,
}) => {
  const files = useMemo(() => {
    return experimental_attachments?.map((attachment) => {
      const dataArray = dataUrlToUint8Array(attachment.url)
      const file = new File([dataArray], attachment.name ?? "Unknown", {
        type: attachment.contentType,
      })
      return file
    })
  }, [experimental_attachments])

  const isUser = role === "user"
  const [downloadingChartUrl, setDownloadingChartUrl] = useState<string | null>(null)
  const [expandedChartUrl, setExpandedChartUrl] = useState<string | null>(null)
  const videoScrollRef = useRef<HTMLDivElement | null>(null)
  const imageScrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollImagesLeft, setCanScrollImagesLeft] = useState(false)
  const [canScrollImagesRight, setCanScrollImagesRight] = useState(false)

  const updateImageScrollButtons = useCallback(() => {
    if (!imageScrollRef.current) {
      setCanScrollImagesLeft(false)
      setCanScrollImagesRight(false)
      return
    }

    const el = imageScrollRef.current
    const maxScrollLeft = el.scrollWidth - el.clientWidth
    const scrollLeft = el.scrollLeft
    const epsilon = 4

    setCanScrollImagesLeft(scrollLeft > epsilon)
    setCanScrollImagesRight(scrollLeft < maxScrollLeft - epsilon)
  }, [])

  useEffect(() => {
    updateImageScrollButtons()
  }, [images, updateImageScrollButtons])

  const resolvedChartUrls = useMemo(() => {
    const urls = [chartUrl, ...(Array.isArray(chartUrls) ? chartUrls : [])]
      .filter((url): url is string => typeof url === "string" && url.trim().length > 0)

    return Array.from(new Set(urls))
  }, [chartUrl, chartUrls])

  const handleDownloadChart = async (url: string) => {
    if (!url) return

    try {
      setDownloadingChartUrl(url)
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Failed to fetch chart: ${response.status}`)
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = "chart.png"
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch (error) {
      console.error("Unable to download chart", error)
    } finally {
      setDownloadingChartUrl(null)
    }
  }

  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('ChatMessage - Role:', role,
      'Sources:', sources ? `Array(${sources.length})` : 'none',
      'Content:', content ? `${content.substring(0, 50)}${content.length > 50 ? '...' : ''}` : 'empty'
    )

    if (sources && sources.length > 0) {
      console.log('Sources details:', JSON.stringify(sources, null, 2));
    }
  }

  const formattedTime = createdAt?.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

  const socialCards = Array.isArray(socialProfiles)
    ? socialProfiles.flatMap((group) =>
        (group?.results || []).map((item) => ({
          platform: group.platform,
          handle: item?.handle || "",
          url: item?.url || "",
          title: item?.title || "",
          snippet: item?.snippet || "",
        })),
      ).filter((item) => item.url)
    : []

  const getSocialMeta = (platformLabel?: string) => {
    const label = String(platformLabel || "").toLowerCase()
    if (label.includes("linkedin")) {
      return { Icon: Linkedin, classes: "bg-[#0a66c2]/10 text-[#0a66c2]" }
    }
    if (label.includes("instagram")) {
      return { Icon: Instagram, classes: "bg-[#e1306c]/10 text-[#e1306c]" }
    }
    if (label.includes("facebook")) {
      return { Icon: Facebook, classes: "bg-[#1877f2]/10 text-[#1877f2]" }
    }
    if (label.includes("twitter") || label.includes("x/") || label === "x") {
      return { Icon: Twitter, classes: "bg-[#0f1419]/10 text-[#0f1419] dark:text-white" }
    }
    return { Icon: Globe, classes: "bg-primary/10 text-primary" }
  }

  // Render message with files if present
  const renderMessageContent = (content: string, promptTitleOverride?: string) => (
    <div className={cn("flex flex-col w-full relative", isUser ? "items-end" : "items-start")}>
      <div className={cn(chatBubbleVariants({ isUser, animation }), "relative")}>
        {files && (
          <div className="mb-1 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <FilePreview file={file} key={index} />
            ))}
          </div>
        )}
        {/* commit */}
        {!isUser && (promptTitleOverride || promptTitle) && (
          <div className="flex flex-col gap-1">
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, ease: "circOut" }}
              className="mb-8 text-4xl font-bold font-playfair tracking-tight text-foreground bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent"
            >
              {toSentenceCase(promptTitleOverride || promptTitle || "")}
              <div className="mt-8 h-[2px] w-48 rounded-full bg-gradient-to-r from-primary/40 to-transparent" />
            </motion.div>
          </div>
        )}

        {Array.isArray(images) && images.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="mt-2"
          >
            <div className="relative -mx-3 mb-6">
              <div className="flex items-center gap-2.5 mb-4 px-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-border/10">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold text-foreground">Google Image Search</h3>
                <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-blue-500/10 px-1 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                  {images.length}
                </span>
              </div>

              {images.length > 1 && (
                <div className="absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              {images.length > 1 && (
                <div className="absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
              )}

              {images.length > 1 && canScrollImagesLeft && (
                <button
                  type="button"
                  className="absolute left-2 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-background/80 p-2 text-foreground shadow-lg backdrop-blur-md transition-all hover:bg-background hover:scale-110 active:scale-95"
                  onClick={() => {
                    if (imageScrollRef.current) {
                      imageScrollRef.current.scrollBy({ left: -260, behavior: 'smooth' })
                    }
                  }}
                  aria-label="Scroll images left"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </button>
              )}
              {images.length > 1 && canScrollImagesRight && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center rounded-full border border-border/40 bg-background/80 p-2 text-foreground shadow-lg backdrop-blur-md transition-all hover:bg-background hover:scale-110 active:scale-95"
                  onClick={() => {
                    if (imageScrollRef.current) {
                      imageScrollRef.current.scrollBy({ left: 260, behavior: 'smooth' })
                    }
                  }}
                  aria-label="Scroll images right"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              <div
                ref={imageScrollRef}
                onScroll={updateImageScrollButtons}
                className="web-images-scroll flex min-w-[280px] gap-5 px-4 overflow-x-auto no-scrollbar py-4"
                style={{
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {images
                  .filter((img) => typeof img?.imageUrl === 'string' && img.imageUrl)
                  .map((img, index) => {
                    const targetHref = typeof img?.pageUrl === 'string' && img.pageUrl?.trim().length > 0
                      ? img.pageUrl
                      : img.imageUrl;
                    const caption = (typeof img?.title === 'string' && img.title?.trim().length > 0)
                      ? img.title
                      : 'View image';

                    const hostname = (() => {
                      try {
                        const url = new URL(targetHref || '');
                        return url.hostname.replace(/^www\./, '');
                      } catch {
                        return '';
                      }
                    })();

                    return (
                      <motion.a
                        key={`${img.imageUrl}-${index}`}
                        href={targetHref ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="group relative flex w-[230px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/40 backdrop-blur-sm shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all hover:-translate-y-1.5 hover:shadow-[0_20px_50px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-white/5 dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
                      >
                        <div className="relative aspect-[4/3] w-full overflow-hidden">
                          <img
                            src={img.imageUrl || ''}
                            alt={caption}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            loading="lazy"
                            onError={(event) => {
                              const el = event.target as HTMLImageElement;
                              el.src = img.thumbnailUrl || '';
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                          <div className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-md transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0 translate-x-2">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </div>
                        </div>

                        <div className="flex flex-col p-3 pt-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[8px] font-bold">
                              {hostname.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              {hostname}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground/90 group-hover:text-primary transition-colors">
                            {caption}
                          </p>
                        </div>
                      </motion.a>
                    );
                  })}
              </div>
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
          className="relative min-h-[1.5em] overflow-hidden"
          style={{
            fontFamily: '"Inter", "Nunito", "Helvetica Neue", Arial, sans-serif',
            fontWeight: 400,
            lineHeight: 2,
            fontSize: '0.9rem',
          }}
        >
          <MarkdownRenderer>
            {content}
          </MarkdownRenderer>
          {/* {!isComplete && !isUser && <BlinkingCursor />} */}
        </motion.div>

        {socialCards.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45, ease: "easeOut" }}
            className="mt-6 pt-6 border-t border-border/40"
          >
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">Social profiles</span>
                  <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-bold text-primary">
                    {socialCards.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {socialCards.map((card, idx) => {
                const { Icon, classes } = getSocialMeta(card.platform)
                return (
                <a
                  key={`${card.url}-${idx}`}
                  href={card.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col gap-2 rounded-2xl border border-border/40 bg-background/40 p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${classes}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {card.platform}
                      </span>
                      {card.handle && (
                        <span className="text-xs font-semibold text-foreground">
                          @{card.handle}
                        </span>
                      )}
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2">
                    {card.title || card.snippet || card.url}
                  </div>
                </a>
              )})}
            </div>
          </motion.div>
        )}

        {socialCards.length === 0 && socialReason && (
          <div className="mt-6 text-xs text-muted-foreground">
            Social profiles: {socialReason}
          </div>
        )}
        {Array.isArray(videos) && videos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6, ease: "easeOut" }}
            className="mt-8 pt-6 border-t border-border/40"
          >
            <div className="flex items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-border/10 overflow-hidden">
                  <svg viewBox="0 0 24 24" className="h-5 w-5">
                    <path
                      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
                      fill="#FF0000"
                    />
                    <path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FFFFFF" />
                  </svg>
                </div>
                <div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground">Video Recommendations</span>
                    <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-bold text-primary">
                      {videos.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-muted/50"
                  onClick={() => {
                    if (videoScrollRef.current) {
                      videoScrollRef.current.scrollBy({ left: -280, behavior: 'smooth' })
                    }
                  }}
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-muted/50"
                  onClick={() => {
                    if (videoScrollRef.current) {
                      videoScrollRef.current.scrollBy({ left: 280, behavior: 'smooth' })
                    }
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="relative -mx-3 pb-4">
              <div
                ref={videoScrollRef}
                className="flex gap-4 px-4 overflow-x-auto no-scrollbar py-2"
                style={{
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {videos
                  .filter((video) => typeof (video?.url || video?.videoId) === 'string')
                  .map((video, index) => {
                    const extractVideoId = (url?: string) => {
                      if (!url) return undefined;
                      try {
                        const parsed = new URL(url);
                        if (parsed.hostname.includes('youtu.be')) {
                          return parsed.pathname.replace('/', '').trim();
                        }
                        if (parsed.searchParams.has('v')) {
                          return parsed.searchParams.get('v')?.trim() || undefined;
                        }
                        const match = parsed.pathname.split('/').filter(Boolean);
                        if (match[0] === 'embed' && match[1]) {
                          return match[1];
                        }
                      } catch (error) {
                        const regex = /(?:v=|\/)([0-9A-Za-z_-]{11})(?:[?&]|$)/;
                        const result = regex.exec(url);
                        if (result && result[1]) {
                          return result[1];
                        }
                      }
                      return undefined;
                    };

                    const derivedVideoId = (typeof video?.videoId === 'string' && video.videoId.trim().length > 0)
                      ? video.videoId.trim()
                      : extractVideoId(video?.url);

                    const targetHref = (() => {
                      if (typeof video?.url === 'string' && video.url.trim().length > 0) {
                        return video.url;
                      }
                      if (derivedVideoId) {
                        return `https://www.youtube.com/watch?v=${derivedVideoId}`;
                      }
                      return undefined;
                    })();

                    const thumbnailUrl = video?.thumbnails?.medium?.url
                      || video?.thumbnails?.high?.url
                      || video?.thumbnails?.default?.url
                      || (derivedVideoId ? `https://img.youtube.com/vi/${derivedVideoId}/hqdefault.jpg` : undefined);

                    const title = (typeof video?.title === 'string' && video.title.trim().length > 0)
                      ? video.title
                      : 'Watch on YouTube';

                    const channel = (typeof video?.channelTitle === 'string' && video.channelTitle.trim().length > 0)
                      ? video.channelTitle
                      : undefined;

                    return (
                      <motion.a
                        key={`${video?.videoId || video?.url || index}`}
                        href={targetHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.1 + 0.3 }}
                        className="group/video relative flex w-[300px] flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-border/40 bg-background/40 backdrop-blur-md transition-all hover:-translate-y-2 hover:border-red-500/40 hover:shadow-[0_20px_60px_rgba(239,68,68,0.15)] dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-black/20">
                          {thumbnailUrl ? (
                            <img
                              src={thumbnailUrl}
                              alt={title}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-white/60">
                              Video unavailable
                            </div>
                          )}

                          <div className="absolute inset-0 bg-black/20 transition-colors duration-300 group-hover/video:bg-black/10" />

                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/90 shadow-[0_4px_15px_rgba(220,38,38,0.4)] transition-all duration-300 group-hover/video:scale-110 group-hover/video:bg-red-600">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                className="h-6 w-6 text-white ml-0.5"
                                fill="currentColor"
                              >
                                <path d="M10 15.5v-7l6 3.5-6 3.5Z" />
                              </svg>
                            </div>
                          </div>

                          <div className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-md">
                            4:20
                          </div>
                        </div>

                        <div className="flex flex-col p-4 pt-3.5">
                          <h4 className="line-clamp-2 text-sm font-bold leading-tight text-foreground/90 transition-colors group-hover/video:text-red-500">
                            {title}
                          </h4>
                          {channel && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {channel}
                              </span>
                              <div className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                              <span className="text-[11px] font-medium text-muted-foreground">
                                YouTube
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.a>
                    );
                  })}
              </div>
            </div>
          </motion.div>
        )}
        {toolEvidence && toolEvidence.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-6 pt-4 border-t border-border/40 relative z-10"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-xs font-semibold text-foreground">Verified platform evidence</h3>
              <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-emerald-500/10 px-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                {toolEvidence.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {toolEvidence.map((ev, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border/40 bg-background/40"
                  title={ev?.evidence_id ? `evidence: ${ev.evidence_id}` : undefined}
                >
                  <div className={`mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${ev?.ok ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-foreground truncate">{ev?.label || ev?.tool || "Evidence"}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2">{ev?.summary}</div>
                    {ev?.evidence_id && <div className="text-[9px] font-mono text-muted-foreground/60 truncate mt-0.5">{ev.evidence_id}</div>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
        {sources && sources.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mt-8 pt-6 border-t border-border/40 relative z-10"
          >
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                <Globe className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-xs font-semibold text-foreground">Sources & Citations</h3>
              <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-blue-500/10 px-1 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                {sources.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto no-scrollbar pr-1">
              {sources.map((source, index) => {
                if (!source) return null;

                try {
                  let href: string;
                  let displayText: string;

                  if (typeof source === 'string') {
                    href = source;
                    try {
                      const url = new URL(href);
                      displayText = url.hostname.replace('www.', '');
                    } catch (e) {
                      return (
                        <div key={index} className="flex items-center gap-2 p-2 rounded-xl bg-muted/30 border border-border/40 text-[10px] text-muted-foreground">
                          <Globe className="h-3 w-3" />
                          <span className="truncate">{source.substring(0, 50)}</span>
                        </div>
                      );
                    }
                  } else {
                    href = source.url;
                    displayText = source.title || (() => {
                      try {
                        const url = new URL(href);
                        return url.hostname.replace('www.', '');
                      } catch {
                        return href;
                      }
                    })();
                  }

                  return (
                    <motion.a
                      key={index}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 + 0.5 }}
                      className="group flex items-center gap-3 p-2.5 rounded-xl border border-border/40 bg-background/40 backdrop-blur-sm transition-all hover:bg-muted/50 hover:border-blue-500/30 hover:translate-x-1"
                      title={displayText}
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-blue-500/10 group-hover:text-blue-600 transition-colors">
                        <Globe className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-foreground/80 group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate transition-colors">
                          {displayText}
                        </div>
                        <div className="text-[9px] text-muted-foreground truncate opacity-70">
                          {href}
                        </div>
                      </div>
                      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                    </motion.a>
                  );
                } catch (e) {
                  return null;
                }
              })}
            </div>
          </motion.div>
        )}
        {excalidrawData && excalidrawData.length > 0 && (
          <div className="mt-4">
            {excalidrawData.map((diagram, index) => (
              <ExcalidrawViewer key={index} data={diagram} />
            ))}
          </div>
        )}
        {graphData && <InlineGraph data={graphData} />}
        {mlPayload && typeof mlPayload === "object" && Object.keys(mlPayload).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-4 space-y-4"
          >
            <p className="text-xs font-medium text-muted-foreground mb-2">ML schema graph</p>
            <MlPayloadGraphViewer
              payload={mlPayload}
              pattern={mlPattern ?? undefined}
              sampleId={mlSampleId ?? undefined}
              height={320}
              className="w-full"
            />
          </motion.div>
        )}
        {classificationResponse != null && (
          <ClassificationResponseBlock data={classificationResponse} />
        )}
        {resolvedChartUrls.length > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
              className="mt-8 pt-6 border-t border-muted-foreground/20 relative z-10 space-y-3"
            >
              <div className="flex items-center gap-2">

              </div>
              <div className="space-y-3">
                {resolvedChartUrls.map((url, index) => {
                  const isDownloading = downloadingChartUrl === url
                  const chartLabel = resolvedChartUrls.length > 1 ? `Chart ${index + 1}` : "Generated chart"
                  return (
                    <div
                      key={`${url}-${index}`}
                      className="space-y-5 md:mx-auto md:max-w-2xl"
                    >
                      <div className="flex flex-col gap-2 px-2 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-3 md:px-0">
                        <span className="text-sm font-medium text-muted-foreground">{chartLabel}</span>
                        <Button
                          type="button"
                          onClick={() => handleDownloadChart(url)}
                          variant="secondary"
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/40 bg-background/80 text-muted-foreground shadow-sm transition hover:bg-background sm:w-auto"
                          disabled={isDownloading}
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Preparing...
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4" />
                              Download chart
                            </>
                          )}
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedChartUrl(url)}
                        className="relative block w-full group focus:outline-none"
                        aria-label={`Expand ${chartLabel}`}
                      >
                        <img
                          src={url}
                          alt={chartLabel}
                          className="w-full h-auto cursor-zoom-in transition-transform duration-200 group-hover:scale-[1.02] group-focus-visible:scale-[1.02] md:mx-auto md:max-h-[360px] md:w-auto"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = "none"
                          }}
                        />
                        <span className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/80 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
                          Tap to expand
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            </motion.div>
            <Dialog
              open={Boolean(expandedChartUrl)}
              onOpenChange={(open) => {
                if (!open) setExpandedChartUrl(null)
              }}
            >
              <DialogContent size="fullscreen" className="w-full gap-4 p-0 sm:p-6">
                <DialogHeader className="flex flex-row items-center justify-between gap-4">
                  <DialogTitle className="text-base sm:text-lg">Generated chart</DialogTitle>
                  <Button
                    type="button"
                    onClick={() => expandedChartUrl && handleDownloadChart(expandedChartUrl)}
                    variant="secondary"
                    className="hidden sm:inline-flex items-center gap-2"
                    disabled={Boolean(expandedChartUrl && downloadingChartUrl === expandedChartUrl)}
                  >
                    {expandedChartUrl && downloadingChartUrl === expandedChartUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Preparing...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Download
                      </>
                    )}
                  </Button>
                </DialogHeader>
                <div className="flex h-full flex-col gap-4 px-4 pb-6 sm:px-0">
                  <div className="flex-1 overflow-auto">
                    {expandedChartUrl && (
                      <img
                        src={expandedChartUrl}
                        alt="Expanded chart"
                        className="mx-auto h-full max-h-[calc(100vh-12rem)] w-full max-w-[min(1400px,100%)] object-contain"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = "none"
                        }}
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={() => expandedChartUrl && handleDownloadChart(expandedChartUrl)}
                    variant="secondary"
                    className="sm:hidden w-full justify-center gap-2"
                    disabled={Boolean(expandedChartUrl && downloadingChartUrl === expandedChartUrl)}
                  >
                    {expandedChartUrl && downloadingChartUrl === expandedChartUrl ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Preparing...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Download chart
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}


        {!isUser && Array.isArray(codeSnippets) && codeSnippets.length > 0 && (
          <div className="mt-8 space-y-4">
            {codeSnippets.map((snippet, index) => (
              <motion.div
                key={`${snippet.language || 'code'}-${index}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="overflow-hidden rounded-2xl border border-border/40 bg-[#0d0d12] shadow-[0_20px_50px_rgba(0,0,0,0.3)] dark:border-white/10"
              >
                <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/20 text-[10px] font-bold text-primary">
                      {snippet.language ? snippet.language.slice(0, 2).toUpperCase() : 'CO'}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                      {snippet.language ? snippet.language : 'Code snippet'}
                    </span>
                  </div>
                  <CopyButton content={snippet.code} />
                </div>
                <div className="p-4">
                  <pre className="overflow-x-auto whitespace-pre-wrap text-[13px] font-mono leading-relaxed text-slate-300">
                    {snippet.code}
                  </pre>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {!isUser && Array.isArray(executionOutputs) && executionOutputs.length > 0 && (
          <div className="mt-6 space-y-4">
            {executionOutputs.map((result, index) => (
              <motion.div
                key={`${result.outcome || 'output'}-${index}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="overflow-hidden rounded-2xl border border-border/40 bg-slate-900/40 backdrop-blur-sm dark:border-white/10"
              >
                <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
                      {result.outcome ? `Terminal — ${result.outcome}` : 'Execution Output'}
                    </span>
                  </div>
                  {result.output && <CopyButton content={result.output} />}
                </div>
                {result.output && (
                  <div className="p-4 bg-black/20">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-[12px] font-mono leading-relaxed text-emerald-400/90">
                      {result.output}
                    </pre>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {
        showTimeStamp && createdAt && (
          <time
            dateTime={createdAt.toISOString()}
            className={cn(
              "mt-1 block px-1 text-xs opacity-50",
              animation !== "none" && "duration-500 animate-in fade-in-0"
            )}
          >
            {formattedTime}
          </time>
        )
      }
      {
        actions && (isComplete === undefined || isComplete) && (
          <div
            className={cn(
              "mt-3 flex space-x-1 rounded-lg border bg-background/95 p-1 text-foreground shadow-sm",
              isUser ? "self-end" : "self-start"
            )}
          >
            {actions}
          </div>
        )
      }
    </div >
  );

  if (isUser) {
    return renderMessageContent(content);
  }

  if (parts && parts.length > 0) {
    return parts.map((part, index) => {
      if (part.type === "text") {
        return (
          <div
            className={cn(
              "flex flex-col w-full",
              isUser ? "items-end" : "items-start"
            )}
            key={`text-${index}`}
          >
            <div className={cn(chatBubbleVariants({ isUser, animation }))}>
              <div className="overflow-hidden">
                <MarkdownRenderer>{part.text}</MarkdownRenderer>
              </div>
            </div>

            {showTimeStamp && createdAt ? (
              <time
                dateTime={createdAt.toISOString()}
                className={cn(
                  "mt-1 block px-1 text-xs opacity-50",
                  animation !== "none" && "duration-500 animate-in fade-in-0"
                )}
              >
                {formattedTime}
              </time>
            ) : null}
            {actions ? (
              <div
                className={cn(
                  "mt-3 flex space-x-1 rounded-lg border bg-background/95 p-1 text-foreground shadow-sm",
                  isUser ? "self-end" : "self-start"
                )}
              >
                {actions}
              </div>
            ) : null}
          </div>
        )
      } else if (part.type === "reasoning") {
        return <ReasoningBlock key={`reasoning-${index}`} part={part} />
      } else if (part.type === "tool-invocation") {
        return (
          <ToolCall
            key={`tool-${index}`}
            toolInvocations={[part.toolInvocation]}
          />
        )
      }
      return null
    })
  }

  if (toolInvocations && toolInvocations.length > 0) {
    return <ToolCall toolInvocations={toolInvocations} />
  }

  // For assistant messages with content but no parts
  if (content) {
    return renderMessageContent(content);
  }

  // Fallback for any other case
  return (
    <div className={cn("flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      <div className={cn(chatBubbleVariants({ isUser, animation }))}>
        <div className="overflow-hidden">
          <MarkdownRenderer>{content}</MarkdownRenderer>
        </div>
      </div>

      {showTimeStamp && createdAt && (
        <time
          dateTime={createdAt.toISOString()}
          className={cn(
            "mt-1 block px-1 text-xs opacity-50",
            animation !== "none" && "duration-500 animate-in fade-in-0"
          )}
        >
          {formattedTime}
        </time>
      )}
      {actions && (
        <div
          className={cn(
            "mt-3 flex space-x-1 rounded-lg border bg-background/95 p-1 text-foreground shadow-sm",
            isUser ? "self-end" : "self-start"
          )}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

function dataUrlToUint8Array(data: string) {
  const base64 = data.split(",")[1]
  const buf = Buffer.from(base64, "base64")
  return new Uint8Array(buf)
}

const ReasoningBlock = ({ part }: { part: ReasoningPart }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-col items-start w-full max-w-[95%] sm:max-w-[85%]"
    >
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="group w-full overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/5 to-primary/10 shadow-[0_10px_30px_rgba(var(--primary-rgb),0.05)] backdrop-blur-md transition-all hover:border-primary/30"
      >
        <div className="p-1">
          <CollapsibleTrigger asChild>
            <button className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-inner transition-transform group-hover:scale-105">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="flex flex-col items-start">
                  <h3 className="text-xs font-semibold text-primary">Thought Process</h3>
                </div>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 transition-transform group-data-[state=open]:rotate-90">
                <ChevronRight className="h-3.5 w-3.5 text-primary" />
              </div>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent forceMount>
          <motion.div
            initial={false}
            animate={isOpen ? "open" : "closed"}
            variants={{
              open: { height: "auto", opacity: 1 },
              closed: { height: 0, opacity: 0 },
            }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2">
              <div className="relative rounded-2xl bg-white/40 p-5 text-[14px] leading-relaxed text-slate-700 shadow-sm dark:bg-black/30 dark:text-slate-300">
                <div className="absolute left-0 top-0 h-full w-1 rounded-full bg-primary/30" />
                <MarkdownRenderer>{part.reasoning}</MarkdownRenderer>
              </div>
            </div>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  )
}

function ToolCall({
  toolInvocations,
}: Pick<ChatMessageProps, "toolInvocations">) {
  if (!toolInvocations?.length) return null

  return (
    <div className="flex flex-col items-start gap-2 max-w-[90%] sm:max-w-[80%]">
      {toolInvocations.map((invocation, index) => {
        const isCancelled =
          invocation.state === "result" &&
          invocation.result.__cancelled === true

        if (isCancelled) {
          return (
            <div
              key={index}
              className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            >
              <Ban className="h-4 w-4" />
              <span>
                Cancelled{" "}
                <span className="font-mono">
                  {"`"}
                  {invocation.toolName}
                  {"`"}
                </span>
              </span>
            </div>
          )
        }

        switch (invocation.state) {
          case "partial-call":
          case "call":
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/50 px-4 py-2.5 text-sm shadow-sm backdrop-blur-sm"
              >
                <div className="flex h-6 w-6 animate-pulse items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Terminal className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Executing</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground">
                    {invocation.toolName}
                  </span>
                </div>
                <Loader2 className="ml-2 h-3 w-3 animate-spin text-primary" />
              </motion.div>
            )
          case "result":
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/40 shadow-sm backdrop-blur-sm"
              >
                <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-600">
                    <Code2 className="h-3.5 w-3.5" />
                  </div>
                  <span>Function Result — {invocation.toolName}</span>
                </div>
                <div className="p-4 overflow-x-auto">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
                    {JSON.stringify(invocation.result, null, 2)}
                  </pre>
                </div>
              </motion.div>
            )
          default:
            return null
        }
      })}
    </div>
  )
}

const BAND_COLORS: Record<string, string> = {
  high: "#fb7185",
  medium: "#fbbf24",
  low: "#34d399",
}

type GraphDataProp = NonNullable<ChatMessageProps["graphData"]>

/** Inline mini-graph for Neo4j data streamed into the chat — either an
 *  account neighborhood (radial) or a fraud-ring subgraph (nodes + edges). */
function InlineGraph({ data }: { data: GraphDataProp }) {
  // Compact canvas — scale radius to the node count so small rings don't
  // render as a nearly-empty box.
  const nodeCount = data.kind === "neighborhood" ? data.neighbors.length : data.nodes.length
  const w = 340
  const radius = Math.min(105, Math.max(48, nodeCount * 9))
  const h = Math.min(300, Math.max(200, radius * 2 + 90))
  const cx = w / 2
  const cy = h / 2

  if (data.kind === "neighborhood") {
    const shown = data.neighbors.slice(0, 20)
    if (!shown.length) return null
    return (
      <GraphShell title={`Neo4j neighborhood — ${String(data.center).slice(0, 14)}…`} count={`${shown.length} linked counterparties`} w={w} h={h}>
        {shown.map((n, i) => {
          const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2
          const x = cx + radius * Math.cos(angle)
          const y = cy + radius * Math.sin(angle)
          const color = BAND_COLORS[n.band || "low"] || BAND_COLORS.low
          return (
            <g key={n.id}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="#64748b" strokeOpacity={0.4} strokeWidth={1} />
              <circle cx={x} cy={y} r={n.band === "high" ? 8 : n.band === "medium" ? 6 : 5} fill={color} fillOpacity={0.9} />
              <text x={x} y={y - 12} textAnchor="middle" fontSize={7} fill="#94a3b8" fontFamily="monospace">
                {String(n.id).slice(0, 8)}…
              </text>
            </g>
          )
        })}
        <circle cx={cx} cy={cy} r={11} fill="#6aa9ff" stroke="#fff" strokeWidth={1.5} />
        <text x={cx} y={cy + 24} textAnchor="middle" fontSize={8} fill="#e2e8f0" fontFamily="monospace">
          {String(data.center).slice(0, 12)}…
        </text>
      </GraphShell>
    )
  }

  // kind === "ring" — fraud-ring subgraph laid out on a circle
  const shown = data.nodes.slice(0, 24)
  if (!shown.length) return null
  const pos = new Map<string, { x: number; y: number }>()
  shown.forEach((n, i) => {
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2
    pos.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  })
  const visibleEdges = data.edges.filter((e) => pos.has(e.source) && pos.has(e.target))

  return (
    <GraphShell title={`Fraud ring — ${data.label || "campaign"}`} count={`${shown.length} accounts · ${visibleEdges.length} transfer edges`} w={w} h={h}>
      {visibleEdges.map((e, i) => {
        const s = pos.get(e.source)!
        const t = pos.get(e.target)!
        return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#64748b" strokeOpacity={0.45} strokeWidth={1} />
      })}
      {shown.map((n) => {
        const p = pos.get(n.id)!
        const color = BAND_COLORS[n.band || "low"] || BAND_COLORS.low
        return (
          <g key={n.id}>
            <circle cx={p.x} cy={p.y} r={n.band === "high" ? 8 : n.band === "medium" ? 6 : 5} fill={color} fillOpacity={0.9} />
            <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={7} fill="#94a3b8" fontFamily="monospace">
              {String(n.id).slice(0, 8)}…
            </text>
          </g>
        )
      })}
    </GraphShell>
  )
}

function GraphShell({ title, count, w, h, children }: { title: string; count: string; w: number; h: number; children: React.ReactNode }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border/50 bg-slate-950">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <Network className="h-3.5 w-3.5" />
        {title}
        <a href="/analyst/graph" className="ml-auto font-semibold normal-case tracking-normal text-sky-400 hover:text-sky-300">
          Open full graph →
        </a>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full">{children}</svg>
      <div className="flex gap-4 border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground">
        {(["high", "medium", "low"] as const).map((b) => (
          <span key={b} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: BAND_COLORS[b] }} />
            {b}
          </span>
        ))}
        <span className="ml-auto">{count}</span>
      </div>
    </div>
  )
}
