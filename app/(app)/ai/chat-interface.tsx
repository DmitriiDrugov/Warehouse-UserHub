"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useSelectedModel } from "@/components/ui/model-selector";
import type {
  AccessExplanationResult,
  ChatAttachment,
  ChatMessage,
  ChatResult,
  QueryResult,
  UserChatMessage,
} from "@/lib/ai/chat-types";
import { buildExcelCsv, makeCsvReportFileName } from "@/lib/reports/csv";
import { chatAction, clearChatHistoryAction, uploadDocumentProposalAction } from "./actions";

// ─── Quick suggestion chips (matching Stitch design) ─────────────────────────

const SUGGESTIONS = [
  "Who is on shift in WH-B?",
  "Why does Alina Lange not have access?",
  "Show open workforce gaps",
];

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatInterface({ initialMessages = [] }: { initialMessages?: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [hasText, setHasText] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [selectedModel] = useSelectedModel();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachmentUrlsRef = useRef<Set<string>>(new Set());
  const canSend = hasText || selectedFile !== null;

  // Restore focus to the input when the pending transition finishes.
  useEffect(() => {
    if (!isPending) textareaRef.current?.focus();
  }, [isPending]);

  useEffect(() => {
    return () => {
      revokeAttachmentUrls();
    };
  }, []);

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function revokeAttachmentUrls() {
    for (const url of attachmentUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    attachmentUrlsRef.current.clear();
  }

  function clearInput() {
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSelectedFile(null);
    setHasText(false);
  }

  // Serialize the last N messages into plain text so the LLM can resolve
  // pronouns like "them" / "those workers" from a previous query result.
  function buildContext(msgs: ChatMessage[]): string {
    const recent = msgs.slice(-6); // at most 3 exchanges
    const parts: string[] = [];
    for (const msg of recent) {
      if (msg.role === "user") {
        parts.push(`User: ${msg.text}`);
      } else {
        const r = msg.result;
        if (r.type === "query") {
          if (r.rows.length === 0) {
            parts.push(`Assistant [query]: returned 0 rows\nSQL: ${r.sql}`);
          } else {
            const header = r.columns.join(" | ");
            const rows = r.rows
              .slice(0, 20)
              .map((row) => r.columns.map((c) => String(row[c] ?? "—")).join(" | "))
              .join("\n");
            const more = r.rows.length > 20 ? `\n… (${r.rows.length - 20} more rows)` : "";
            parts.push(
              `Assistant [query result, ${r.rows.length} rows]:\nSQL: ${r.sql}\n${header}\n${rows}${more}`,
            );
          }
        } else if (r.type === "update") {
          parts.push(`Assistant [update]: ${r.summary}`);
        } else if (r.type === "provision") {
          parts.push(`Assistant [provision]: ${r.explanation}`);
        } else if (r.type === "access_explain") {
          parts.push(`Assistant [access explanation]: ${r.summary}\n${r.reasons.join("\n")}`);
        } else if (r.type === "unsupported" || r.type === "error") {
          parts.push(`Assistant: ${r.message}`);
        }
      }
    }
    return parts.join("\n\n");
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsPending(false);
  }

  function handleSend(options: { fileOverride?: File | null } = {}) {
    const controller = new AbortController();
    const text = textareaRef.current?.value ?? "";
    const trimmedText = text.trim();
    const file = options.fileOverride === undefined ? selectedFile : options.fileOverride;
    if (!trimmedText && !file) return;

    let attachment: ChatAttachment | undefined;
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      attachmentUrlsRef.current.add(previewUrl);
      attachment = {
        name: file.name || "document",
        size: file.size,
        mimeType: file.type || undefined,
        previewUrl,
      };
    }

    const userText = file ? trimmedText || "Uploaded document" : text;

    const userMsg: UserChatMessage = { id: crypto.randomUUID(), role: "user", text: userText, attachment };
    setMessages((prev) => [...prev, userMsg]);
    clearInput();
    scrollToBottom();
    abortRef.current = controller;
    setIsPending(true);
    const context = buildContext(messages);
    void (async () => {
      try {
        const fd = new FormData();
        fd.set("model", selectedModel);
        let result: ChatResult;
        if (file) {
          fd.set("file", file);
          if (trimmedText) fd.set("notes", trimmedText);
          result = await uploadDocumentProposalAction(fd);
        } else {
          fd.set("text", text);
          if (context) fd.set("context", context);
          result = await chatAction(fd);
        }
        if (!controller.signal.aborted) {
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", result }]);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setMessages((prev) => [...prev, {
            id: crypto.randomUUID(),
            role: "assistant",
            result: { type: "error", message: err instanceof Error ? err.message : String(err) },
          }]);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsPending(false);
        }
        scrollToBottom();
      }
    })();
  }

  function handleSendText(text: string) {
    if (textareaRef.current) textareaRef.current.value = text;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSelectedFile(null);
    handleSend({ fileOverride: null });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) setSelectedFile(file);
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach document"
                  aria-label="Attach document"
                  className="w-10 h-10 rounded flex items-center justify-center border border-border-subtle text-on-surface-variant hover:text-proposal-violet hover:border-proposal-violet/40 hover:bg-surface-container-low active:scale-95 transition-all disabled:opacity-50"
                >
                  <Icon name="attach_file" size={20} />
                </button>
                {isPending ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    title="Stop"
                    className="w-10 h-10 rounded flex items-center justify-center bg-status-danger/10 text-status-danger border border-status-danger/30 hover:bg-status-danger/20 active:scale-95 transition-all"
                  >
                    <Icon name="stop" size={20} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={() => handleSend()}
                    className="bg-proposal-violet text-on-primary w-10 h-10 rounded flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                  >
                    <Icon name="send" size={20} />
                  </button>
                )}
              </div>
            </div>
            {selectedFile ? (
              <div className="px-3 pb-2">
                <div className="inline-flex max-w-full items-center gap-2 rounded-md border border-border-subtle bg-surface-container-low px-2.5 py-1.5 text-on-surface-variant">
                  <Icon name="description" size={16} className="shrink-0" />
                  <span className="truncate font-label text-[12px]">
                    {selectedFile.name}
                  </span>
                  <span className="shrink-0 font-label text-[11px] text-outline">
                    {formatFileSize(selectedFile.size)}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    title="Remove attachment"
                    aria-label="Remove attachment"
                    className="shrink-0 rounded p-0.5 hover:bg-surface-container-highest hover:text-status-danger transition-colors"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </div>
            ) : null}
            {/* Status bar */}
            <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border-subtle/50 text-[11px] text-on-surface-variant/70">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
                <span>Secure Channel Active</span>
              </div>
              {messages.length > 0 ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    void (async () => {
                      const result = await clearChatHistoryAction();
                      if (result.ok) {
                        setMessages([]);
                        revokeAttachmentUrls();
                      }
                    })();
                  }}
                  title="Clear chat history"
                  aria-label="Clear chat history"
                  className="ml-auto rounded p-1 text-on-surface-variant hover:text-status-danger hover:bg-surface-container-low transition-colors disabled:opacity-50"
                >
                  <Icon name="delete_sweep" size={16} />
                </button>
              ) : null}
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
    const hasText = message.text.trim().length > 0;

    return (
      <div className="flex justify-end">
        <div className="bg-surface-container-highest/50 px-5 py-3 rounded-xl max-w-2xl border border-border-subtle space-y-3 min-w-0">
          {hasText ? (
            <p className="text-body-lg font-body-lg whitespace-pre-wrap break-words">{message.text}</p>
          ) : null}
          {message.attachment ? <MessageFilePreview attachment={message.attachment} /> : null}
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
      <div className="flex-1 space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-3 max-w-3xl">
          <span className="font-label text-label text-proposal-violet font-semibold">Warehouse AI</span>
          {result.type === "query" && result.rows.length > 0 ? (
            <QueryReportMenu result={result} />
          ) : null}
        </div>
        <ResultRenderer result={result} />
      </div>
    </div>
  );
}

function MessageFilePreview({ attachment }: { attachment: ChatAttachment }) {
  const fileKind = getFileKind(attachment);
  const details = [fileKind, attachment.size !== undefined ? formatFileSize(attachment.size) : null]
    .filter(Boolean)
    .join(" - ");
  const isImage = attachment.mimeType?.startsWith("image/") ?? false;
  const content = (
    <>
      {isImage && attachment.previewUrl ? (
        <img
          src={attachment.previewUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded border border-border-subtle object-cover bg-surface-container-lowest"
        />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded border border-border-subtle bg-surface-container-lowest flex items-center justify-center text-primary">
          <Icon name={fileKind === "PDF" ? "picture_as_pdf" : "description"} size={24} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-label text-[12px] text-on-surface">{attachment.name}</span>
        {details ? (
          <span className="block truncate font-label text-[11px] text-on-surface-variant">{details}</span>
        ) : null}
      </span>
      {attachment.previewUrl ? (
        <Icon name="open_in_new" size={16} className="shrink-0 text-on-surface-variant" />
      ) : null}
    </>
  );

  if (!attachment.previewUrl) {
    return (
      <div className="flex max-w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface-container-lowest/70 px-3 py-2">
        {content}
      </div>
    );
  }

  return (
    <a
      href={attachment.previewUrl}
      target="_blank"
      rel="noreferrer"
      title={`Open ${attachment.name}`}
      className="flex max-w-full items-center gap-3 rounded-lg border border-border-subtle bg-surface-container-lowest/70 px-3 py-2 text-left hover:border-primary/40 hover:bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-proposal-violet/25 transition-colors"
    >
      {content}
    </a>
  );
}

function QueryReportMenu({ result }: { result: QueryResult }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function downloadCsvReport() {
    const csv = buildExcelCsv(result.columns, result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = makeCsvReportFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setOpen(false);
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-border-subtle transition-colors"
      >
        <Icon name="more_vert" size={18} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border-subtle bg-surface-container-lowest p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={downloadCsvReport}
            className="w-full flex items-center gap-2 rounded px-3 py-2 font-label text-label text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
          >
            <Icon name="download" size={16} />
            <span>Export CSV</span>
          </button>
        </div>
      ) : null}
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
          <p className="font-body-sm text-body-sm text-on-surface">{result.explanation}</p>
          {result.documentFileName ? (
            <div className="flex items-center gap-2 text-on-surface-variant font-label text-[12px] min-w-0">
              <Icon name="description" size={16} className="shrink-0" />
              <span className="truncate">{result.documentFileName}</span>
              <span className="shrink-0 text-status-success">staged</span>
            </div>
          ) : null}
          {result.documentWarning ? (
            <div className="flex items-start gap-2 text-status-warning font-body-sm text-body-sm">
              <Icon name="warning" size={16} className="shrink-0 mt-0.5" />
              <span>{result.documentWarning}</span>
            </div>
          ) : null}
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

  if (result.type === "update") {
    return (
      <div className="bg-status-success/5 border border-status-success/30 rounded-xl p-5 space-y-3 max-w-lg">
        <div className="flex items-center gap-2">
          <Icon name="check_circle" size={20} className="text-status-success" fill />
          <span className="font-title text-title text-on-surface">{result.operation}</span>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">{result.summary}</p>
        <div className="space-y-1 pt-1">
          {result.affected.map((w) => (
            <div key={w.employeeId} className="flex items-center gap-2 text-[12px] text-on-surface-variant">
              <Icon name="person" size={14} className="shrink-0" />
              <span>{w.fullName}</span>
              <span className="text-outline font-data-mono">{w.employeeId}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (result.type === "access_explain") {
    return <AccessExplanationCard result={result} />;
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

function AccessExplanationCard({ result }: { result: AccessExplanationResult }) {
  const hasWorker = result.worker !== undefined;
  const accessPreview = result.activeAccess.slice(0, 6);
  const rolePreview = result.expectedRoleAccess.slice(0, 6);
  const certPreview = result.certificates.slice(0, 5);

  return (
    <div className="bg-surface-container-lowest border border-border-subtle rounded-xl p-5 space-y-4 max-w-3xl shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="rule" size={20} className="text-primary" />
            <span className="font-title text-title text-on-surface">Access diagnosis</span>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{result.summary}</p>
        </div>
        {result.targetAccess ? (
          <span className="shrink-0 bg-surface-container px-2 py-1 rounded font-label text-[11px] text-on-surface-variant">
            {result.targetAccess}
          </span>
        ) : null}
      </div>

      {hasWorker ? (
        <div className="flex flex-wrap items-center gap-2 font-label text-[12px] text-on-surface-variant">
          <span className="bg-surface-container px-2 py-1 rounded font-data-mono text-data-mono">
            {result.worker!.employeeId}
          </span>
          <span>{result.worker!.fullName}</span>
          <span className="text-outline">/</span>
          <span>{result.worker!.roleName}</span>
          <span className="text-outline">/</span>
          <span>{result.worker!.warehouseCode}</span>
          <span className="text-outline">/</span>
          <span className={statusClassName(result.worker!.status)}>{result.worker!.status}</span>
          <Link href={`/warehouse-users/${result.worker!.id}`} className="text-primary hover:underline ml-1">
            Open worker
          </Link>
        </div>
      ) : null}

      {result.reasons.length > 0 ? (
        <div className="space-y-2">
          {result.reasons.map((reason, index) => (
            <div key={`${index}-${reason}`} className="flex gap-2 font-body-sm text-body-sm text-on-surface">
              <Icon name="chevron_right" size={16} className="text-primary shrink-0 mt-0.5" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      ) : null}

      {result.candidates && result.candidates.length > 0 ? (
        <div className="border-t border-border-subtle pt-3">
          <div className="grid gap-2">
            {result.candidates.map((candidate) => (
              <div key={candidate.employeeId} className="flex flex-wrap items-center gap-2 font-label text-[12px] text-on-surface-variant">
                <span className="font-data-mono text-data-mono text-on-surface">{candidate.employeeId}</span>
                <span>{candidate.fullName}</span>
                <span className="text-outline">/</span>
                <span>{candidate.roleName}</span>
                <span className="text-outline">/</span>
                <span>{candidate.warehouseCode}</span>
                <span className={statusClassName(candidate.status)}>{candidate.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasWorker ? (
        <div className="grid md:grid-cols-3 gap-4 border-t border-border-subtle pt-4">
          <AccessMiniSection
            title="Active grants"
            empty="No active grants"
            items={accessPreview.map((a) => ({
              key: `${a.systemCode}.${a.permissionCode}`,
              primary: `${a.systemCode}.${a.permissionCode}`,
              secondary: a.permissionName,
            }))}
          />
          <AccessMiniSection
            title="Role template"
            empty="No template grants"
            items={rolePreview.map((a) => ({
              key: `${a.systemCode}.${a.permissionCode}`,
              primary: `${a.systemCode}.${a.permissionCode}`,
              secondary: a.permissionName,
            }))}
          />
          <AccessMiniSection
            title="Certificates"
            empty="No certificates"
            items={certPreview.map((c) => ({
              key: c.certificateCode,
              primary: c.certificateCode,
              secondary: `${c.status}${c.expiresAt ? ` - expires ${formatIsoDate(c.expiresAt)}` : ""}`,
              danger: c.status !== "valid" || c.isExpired,
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

function AccessMiniSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; primary: string; secondary: string; danger?: boolean }>;
}) {
  return (
    <div className="space-y-2 min-w-0">
      <p className="font-label text-[11px] uppercase text-on-surface-variant">{title}</p>
      {items.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className={item.danger ? "font-data-mono text-data-mono text-status-warning truncate" : "font-data-mono text-data-mono text-on-surface truncate"}>
                {item.primary}
              </div>
              <div className="font-body-sm text-[12px] text-on-surface-variant truncate">
                {item.secondary}
              </div>
            </div>
          ))}
        </div>
      )}
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

function formatIsoDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusClassName(status: string): string {
  if (status === "active" || status === "valid") return "text-status-success";
  if (status === "pending") return "text-status-warning";
  if (status === "suspended" || status === "offboarded" || status === "expired" || status === "revoked") {
    return "text-status-danger";
  }
  return "text-on-surface-variant";
}

function getFileKind(attachment: ChatAttachment): string {
  if (attachment.mimeType === "application/pdf") return "PDF";
  if (attachment.mimeType?.startsWith("image/")) return "Image";

  const extension = attachment.name.split(".").pop()?.trim();
  if (extension && extension !== attachment.name) return extension.toUpperCase();
  return "File";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
