"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useSelectedModel } from "@/components/ui/model-selector";
import type { ChatResult } from "./actions";
import { chatAction, uploadDocAction } from "./actions";

// ─── Message types ────────────────────────────────────────────────────────────

type UserMessage = { id: string; role: "user"; text: string; fileName?: string };
type AssistantMessage = { id: string; role: "assistant"; result: ChatResult };
type ChatMessage = UserMessage | AssistantMessage;

// ─── Quick suggestion chips (matching Stitch design) ─────────────────────────

const SUGGESTIONS = [
  "Who is on shift in WH-B?",
  "Generate audit for Zone A",
  "Show open workforce gaps",
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasText, setHasText] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedModel] = useSelectedModel();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function handleSendText(text: string) {
    if (!text.trim()) return;
    const userMsg: UserMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    if (textareaRef.current) { textareaRef.current.value = ""; textareaRef.current.style.height = "auto"; setHasText(false); textareaRef.current.focus(); }
    scrollToBottom();

    startTransition(async () => {
      const fd = new FormData();
      fd.set("text", text);
      fd.set("model", selectedModel);
      const result = await chatAction(fd);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", result }]);
      scrollToBottom();
    });
  }

  function handleSendFile(file: File) {
    const userMsg: UserMessage = { id: crypto.randomUUID(), role: "user", text: `📄 ${file.name}`, fileName: file.name };
    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("model", selectedModel);
      const result = await uploadDocAction(fd);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", result }]);
      scrollToBottom();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText(textareaRef.current?.value ?? "");
    }
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-3.5rem-1px)] -mt-6 -mx-gutter">
      {/* History zone */}
      <div className="flex-1 overflow-y-auto px-gutter pt-8 pb-44 max-w-[1200px] mx-auto w-full">
        {messages.length === 0 && <EmptyState />}
        <div className="space-y-10">
          {messages.map((msg) => (
            <MessagePair key={msg.id} message={msg} />
          ))}
          {isPending && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input zone — fixed at bottom, gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 px-gutter bg-gradient-to-t from-bg-page via-bg-page/95 to-transparent pt-10 pb-4">
        <div className="max-w-[1200px] mx-auto w-full">
          <div className="bg-surface-container-lowest border border-border-subtle rounded-xl shadow-lg p-2 focus-within:ring-2 focus-within:ring-proposal-violet/20 focus-within:border-proposal-violet transition-all">
            <div className="flex items-end gap-2">
              <div className="flex-1 px-3 py-2">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  disabled={isPending}
                  onKeyDown={handleKeyDown}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = `${t.scrollHeight}px`;
                    setHasText(t.value.length > 0);
                  }}
                  placeholder="Ask about workers, schedules, or warehouse audits…"
                  className="w-full bg-transparent border-none focus:ring-0 resize-none placeholder:text-outline max-h-40 min-h-[44px] text-body-lg font-body-lg"
                />
              </div>
              <div className="flex items-center gap-2 pb-2 pr-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSendFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach document (PDF, JPG, PNG)"
                  className="p-2 text-on-surface-variant hover:bg-surface-container transition-colors rounded-lg disabled:opacity-50"
                >
                  <Icon name="attach_file" size={20} />
                </button>
                <button
                  type="button"
                  disabled={isPending || !hasText}
                  onClick={() => handleSendText(textareaRef.current?.value ?? "")}
                  className="bg-proposal-violet text-on-primary w-10 h-10 rounded flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Icon name="send" size={20} />
                </button>
              </div>
            </div>
            {/* Status bar */}
            <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border-subtle/50 text-[11px] text-on-surface-variant/70">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                <span>Secure Channel Active</span>
              </div>
            </div>
          </div>
          {/* Suggestion chips */}
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSendText(s)}
                className="px-3 py-1 rounded-full border border-border-subtle bg-surface-container-lowest font-label text-label text-on-surface-variant hover:border-proposal-violet hover:text-proposal-violet transition-all text-[12px]"
              >
                &ldquo;{s}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message renderers ────────────────────────────────────────────────────────

function MessagePair({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-surface-container-highest/50 px-5 py-3 rounded-xl max-w-2xl border border-border-subtle">
          <p className="text-body-lg font-body-lg">{message.text}</p>
        </div>
      </div>
    );
  }

  const { result } = message;

  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-proposal-violet/10 flex items-center justify-center shrink-0 mt-1">
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
      </div>
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-label text-label text-proposal-violet font-semibold">Warehouse AI</span>
        </div>
        <ResultRenderer result={result} />
      </div>
    </div>
  );
}

function ResultRenderer({ result }: { result: ChatResult }) {
  if (result.type === "query") {
    return (
      <div className="space-y-2">
        <span className="font-label text-[11px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded">
          {result.rows.length} row{result.rows.length !== 1 ? "s" : ""} · {result.durationMs} ms
        </span>
        {result.rows.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant">Query returned 0 rows.</p>
        ) : (
          <div className="bg-surface-container-lowest border border-border-subtle rounded-lg overflow-hidden shadow-sm max-w-3xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-border-subtle">
                    {result.columns.map((c) => (
                      <th key={c} className="px-4 py-2 font-label text-label text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-table-cell text-table-cell">
                  {result.rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-container-lowest">
                      {result.columns.map((c) => (
                        <td key={c} className="px-4 py-2 font-data-mono text-data-mono">
                          {formatCell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (result.type === "provision") {
    return (
      <div className="bg-violet-50/50 border border-dashed border-proposal-violet rounded-xl p-5 space-y-4 max-w-lg"
           style={{ boxShadow: "0 0 15px rgba(124, 58, 237, 0.1)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="bolt" size={20} className="text-proposal-violet" />
            <span className="font-title text-title text-proposal-violet">✦ Proposal queued</span>
          </div>
          <span className="bg-violet-100 text-proposal-violet px-2 py-0.5 rounded font-label text-[11px]">
            Awaiting approval
          </span>
        </div>
        <div className="space-y-2">
          {result.fromDocument && (
            <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <Icon name="description" size={14} />
              Parsed from uploaded document
            </div>
          )}
          <p className="font-body-sm text-body-sm text-on-surface">{result.explanation}</p>
          <div className="flex items-center gap-2 text-primary font-label text-label">
            <Icon name="link" size={16} />
            <Link href={`/proposals/${result.proposalId}`} className="hover:underline">
              Open proposal #{result.proposalId.slice(0, 8)}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (result.type === "unsupported") {
    return (
      <div className="bg-status-warning/5 border border-status-warning/30 rounded-xl p-5 max-w-lg flex gap-4">
        <Icon name="warning" size={20} className="text-status-warning shrink-0" />
        <div>
          <p className="font-title text-title text-on-surface leading-tight mb-1">Action limited</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{result.message}</p>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="flex items-start gap-2 text-status-danger font-body-sm text-body-sm">
      <Icon name="error" size={18} />
      {result.message}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-proposal-violet/10 flex items-center justify-center shrink-0 mt-1">
        <Icon name="auto_awesome" size={18} className="text-proposal-violet" fill />
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-2 h-2 rounded-full bg-proposal-violet/40 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center text-on-surface-variant">
      <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
        <Icon name="auto_awesome" size={32} className="text-proposal-violet" />
      </div>
      <h2 className="font-title text-title text-on-surface mb-1">AI Assistant</h2>
      <p className="font-body-sm text-body-sm max-w-sm">
        Ask about workforce data, create new workers, or upload an employment document to provision automatically.
      </p>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
