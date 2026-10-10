"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Send, MessageSquare, FileSearch, Plus, ArrowUpRight, ScanLine, Files, GitBranch, ClipboardCheck, Copy, Check, RotateCcw, ShieldCheck } from "lucide-react";
import BusinessShell, { Panel, State, evidenceLabel } from "@/components/BusinessShell";
import BusinessGraph from "@/components/BusinessGraph";
import { Textarea } from "@/components/ui/textarea";
import { businessApi, money, type BusinessCase, type ChatAnswer, type Finding, type Snapshot } from "@/lib/business-api";

type Answer = ChatAnswer & { findings?: Finding[]; ambiguities?: Snapshot["ambiguities"]; graphUnavailable?: boolean; caseOptions?: { id: string; title: string; poId: string }[] };
type Turn = { id: number; prompt: string; answer?: Answer; error?: string };

function formatContent(content: string) {
  if (/^#{1,6}\s|\*\*|```/m.test(content)) return content;
  return content.split(/\n\s*\n/).map((paragraph, index) => {
    let text = paragraph.replace(/\b(INR|USD|EUR) (-?\d+(?:\.\d+)?)/g, "**$1 $2**").replace(/\b(PO-\d+)\b/g, "**$1**");
    const colon = text.indexOf(":");
    if (colon > 0 && colon < 100 && !text.slice(0, colon).includes("\n") && !text.slice(0, colon).includes("**")) text = `**${text.slice(0, colon)}:**${text.slice(colon + 1)}`;
    return index === 0 && !text.includes("**") && text.length < 180 ? `**${text}**` : text;
  }).join("\n\n");
}

function MarkdownAnswer({ content }: { content: string }) {
  return <div className="satya-chat-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ table: ({ children }) => <div className="satya-table-wrap"><table>{children}</table></div>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt || "Image omitted from the answer"}</span> }}>{formatContent(content)}</ReactMarkdown></div>;
}

function AnswerCard({ answer, onChoose }: { answer: Answer; onChoose: (id: string) => void }) {
  const [copyState, setCopyState] = useState("");
  const facts = answer.facts;
  const structured = facts && answer.findings && answer.answerType === 'overview';
  const summaryCards = facts ? [
    ["Delivery-supported balance", money(facts.supportedOutstanding, facts.currency), "Delivered goods, less linked payments"],
    ["Payments linked to invoices", money(facts.settled, facts.currency), "Confirmed or source-referenced payments"],
    ["Possible duplicate amount", money(facts.disputedExposure, facts.currency), "Disputed amount, not confirmed savings"],
  ] : null;
  const questionCards = facts ? ({
    delivery: [["Units ordered", facts.ordered, "On the purchase order"], ["Units received", facts.received, "Net receipts at this snapshot"], ["Still to deliver", facts.openDelivery, "Not received against the order yet"]],
    payments: [["Payments linked to invoices", money(facts.settled, facts.currency), "Confirmed or source-referenced payments"], ["Recorded outstanding", money(facts.recordedOutstanding, facts.currency), "What the ledgers still show as owed"], ["Delivery-supported balance", money(facts.supportedOutstanding, facts.currency), "Delivered goods, less linked payments"]],
  } as Record<string, string[][]>)[answer.answerType || ""] : undefined;
  const cards = questionCards || (summaryCards && ['overview', 'balance', 'issues', 'decision'].includes(answer.answerType || 'overview') ? summaryCards : null);
  const sources = answer.sources || [];
  const sourceLink = (source: Answer["sources"][number]) => <Link className="satya-evidence-chip" key={source.id} href={`/cases/${encodeURIComponent(source.caseId)}?snapshot=${encodeURIComponent(answer.snapshotId || "")}&evidence=${encodeURIComponent(source.id)}`}><FileSearch size={15} />{source.label.replaceAll("_", " ")}</Link>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(answer.content); setCopyState("Copied"); }
    catch { setCopyState("Copy unavailable. Select the answer text to copy it."); }
  };

  return <div className="satya-answer-reveal"><Panel>
    <div className="satya-assistant-label"><span className="satya-mark small" aria-hidden="true">S</span>Satya<span className="satya-tag"><ShieldCheck size={14} className="mr-2" />{sources.length ? "Based on your records" : "Workspace guidance"}</span></div>
    {cards && <div className="satya-chat-facts">{cards.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</div>}
    <MarkdownAnswer content={answer.content} />
    {structured && !!answer.findings?.length && <details className="satya-chat-section"><summary>Supporting record checks ({answer.findings.length})</summary>{answer.findings.map((finding) => <article key={finding.id} className={`satya-finding ${finding.severity}`}><div className="satya-case-card-top"><h3>{evidenceLabel(finding.title)}</h3><span className="satya-tag">{evidenceLabel(finding.certainty)}</span></div><p>{finding.detail}</p><span className="satya-next">Next step: {evidenceLabel(finding.action)}</span></article>)}</details>}
    {!!answer.caseOptions?.length && <div className="satya-chat-section"><h3>Choose an investigation</h3><div className="satya-chat-sources">{answer.caseOptions.map((item) => <button className="satya-button secondary" key={item.id} onClick={() => onChoose(item.id)}>{item.poId} · {item.title}<ArrowUpRight size={16} /></button>)}</div></div>}
    {!!sources.length && <div className="satya-chat-section"><h3>Records behind this answer <span className="satya-tag ml-2">{sources.length}</span></h3><p>Open a source to inspect the exact record used for this answer.</p><div className="satya-chat-sources">{sources.slice(0, 6).map(sourceLink)}</div>{sources.length > 6 && <details className="mt-4"><summary className="text-sm">Show {sources.length - 6} more sources</summary><div className="satya-chat-sources">{sources.slice(6).map(sourceLink)}</div></details>}</div>}
    {answer.graph && <details className="satya-chat-section"><summary><strong>Explore the record connections</strong><span className="satya-tag ml-2">{answer.graph.nodes.length} records · {answer.graph.edges.length} links</span></summary><p className="text-sm text-muted-foreground my-4">See how the orders, deliveries, invoices and payments connect. Dashed lines are possibilities, not confirmed matches.</p><BusinessGraph graph={answer.graph} /></details>}
    {answer.graphUnavailable && !answer.graph && <div className="satya-notice">Record connections could not be loaded. The answer and its sources are still available.</div>}
    {answer.queriedAt && <p className="satya-answer-freshness">Read live at {new Date(answer.queriedAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · {answer.responseMode === 'grounded_ai' ? 'Grounded AI explanation' : 'Evidence-tool answer'}</p>}
    {answer.providerStatus === 'authentication_required' && <div className="satya-notice warning">The configured language provider rejected its credentials. This question was answered from evidence tools; ask your administrator to reconnect the provider.</div>}
    {answer.snapshotId && <details className="satya-chat-section"><summary className="text-sm">About these figures</summary><p className="text-sm text-muted-foreground mt-3">Amounts come from the stored calculation, not a generated estimate. This answer uses record version <span className="font-mono">{answer.snapshotId}</span>. Later changes may produce a different balance.</p></details>}
    <div className="satya-answer-footer"><div><button className="satya-button secondary" onClick={copy}>{copyState === "Copied" ? <Check size={16} /> : <Copy size={16} />}{copyState === "Copied" ? "Copied" : "Copy answer"}</button>{copyState && <span role="status" className="text-xs ml-3">{copyState}</span>}</div>{answer.caseId && <Link href={`/cases/${encodeURIComponent(answer.caseId)}`} className="satya-button secondary">Open investigation <ArrowUpRight size={16} /></Link>}</div>
  </Panel></div>;
}

function Copilot() {
  const params = useSearchParams();
  const [cases, setCases] = useState<BusinessCase[]>([]);
  const [caseId, setCaseId] = useState(params.get("case") || "");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState('Connecting to current company records');
  const [error, setError] = useState("");
  const lock = useRef(false);
  const sequence = useRef(0);
  const latest = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { businessApi.cases().then(setCases).catch((error) => setError(error.message)); }, []);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => { if (messages.length) latest.current?.scrollIntoView({ behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start" }); }, [messages.length]);
  const reset = (id = caseId) => { if (lock.current) return; setCaseId(id); setMessages([]); setConversationId(undefined); setQuestion(""); setError(""); input.current?.focus(); };
  const send = async (prompt: string, retryId?: number) => {
    const text = prompt.trim();
    if (!text || lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setStage('Connecting to current company records');
    const id = retryId ?? ++sequence.current;
    if (retryId !== undefined) setMessages((previous) => previous.map((turn) => turn.id === id ? { id, prompt:text } : turn));
    else { setMessages((previous) => [...previous, { id, prompt:text }]); setQuestion(""); }
    try {
      const answer: Answer = await businessApi.chat(text, caseId || undefined, conversationId, setStage);
      setMessages((previous) => previous.map((turn) => turn.id === id ? { ...turn, answer } : turn));
      setConversationId(answer.conversationId);
      if (answer.caseId) setCaseId(answer.caseId);
    } catch (error) {
      setMessages((previous) => previous.map((turn) => turn.id === id ? { ...turn, error:error instanceof Error ? error.message : "The answer could not be loaded. Please try again." } : turn));
    } finally { lock.current = false; setBusy(false); }
  };
  const selectedCase = cases.find((item) => item.id === caseId);
  const prompts = selectedCase ? [`Summarize ${selectedCase.poId} and its outstanding balance`, `Which issues need review for ${selectedCase.poId}?`, `Explain the payments for ${selectedCase.poId}`, `Which records are missing for ${selectedCase.poId}?`] : ["Why might PO-1001 have a duplicate invoice?", "Explain the payments for PO-1001", "What is the delivery issue in PO-3001?", "Help me choose an investigation"];

  return <BusinessShell title="Ask Satya" subtitle="Ask a question about an order. Get a clear explanation with the records to back it up.">
    <div className="satya-chat-toolbar"><div className="satya-chat-context"><label htmlFor="case-context">Which investigation are we looking at?</label><select id="case-context" className="satya-input" disabled={busy} value={caseId} onChange={(event) => reset(event.target.value)}><option value="">Choose from my question</option>{cases.map((item) => <option value={item.id} key={item.id}>{item.poId} · {item.supplier}</option>)}</select></div><button className="satya-button secondary" disabled={busy} onClick={() => reset()}><Plus size={17} />New conversation</button></div>
    <State error={error} />
    <div className="satya-chat-body">
      {messages.length === 0 && <div className="satya-chat-empty"><span className="satya-chat-symbol"><MessageSquare size={32} /></span><h2>What would you like to understand?</h2><p>Check a balance, understand a payment or find out why an invoice needs review. I’ll show what the records say and what’s still missing.</p><div className="satya-prompt-grid">{prompts.map((prompt) => <button disabled={busy} onClick={() => send(prompt)} key={prompt}>{prompt}<ArrowUpRight size={18} /></button>)}</div></div>}
      {messages.map((turn, index) => <div key={turn.id} className="satya-chat-turn" ref={index === messages.length - 1 ? latest : undefined}><div className="satya-user-message"><span className="sr-only">Your question: </span>{turn.prompt}</div>{turn.answer ? <AnswerCard answer={turn.answer} onChoose={(id) => { reset(id); setQuestion(`Summarize ${cases.find((item) => item.id === id)?.poId || "this investigation"}`); }} /> : turn.error ? <Panel><State error={turn.error} /><button className="satya-button secondary" disabled={busy} onClick={() => send(turn.prompt, turn.id)}><RotateCcw size={16} />Try this question again</button></Panel> : <div className="satya-scanner" role="status" aria-live="polite"><div className="satya-scanner-heading"><ScanLine size={24} /><span>{elapsed >= 20 ? 'Still working on your grounded answer…' : stage}</span></div><p>{elapsed >= 20 ? 'The service is taking longer than usual. Your question has not been lost.' : 'Reading the current snapshot and relevant source records—not a cached case summary.'}</p><div className="satya-scan-steps" aria-hidden="true"><span><Files size={16} />Source records</span><span><GitBranch size={16} />Record connections</span><span><ClipboardCheck size={16} />Stored calculations</span><span><span className="satya-spin"><RotateCcw size={15} /></span>Working</span></div></div>}</div>)}
    </div>
    <div className="satya-chat-composer"><form className="satya-chat-input" onSubmit={(event) => { event.preventDefault(); send(question); }}><Textarea ref={input} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(question); } }} maxLength={4000} placeholder={selectedCase ? `Ask about ${selectedCase.poId}…` : "Ask about an order, invoice or payment…"} rows={2} aria-label="Your question" disabled={busy} /><button className="satya-button" type="submit" disabled={busy || !question.trim()} aria-label={busy ? "Waiting for answer" : "Send question"}><Send size={19} /><span className="satya-send-label">{busy ? "Working" : "Send"}</span></button></form><div className="satya-composer-help"><span>Enter to send · Shift + Enter for a new line</span><span>{question.length}/4000 · No payments or supplier messages are sent</span></div></div>
  </BusinessShell>;
}

export default function ChatPage() {
  return <Suspense fallback={<div className="p-8" role="status">Loading Ask Satya…</div>}><Copilot /></Suspense>;
}
