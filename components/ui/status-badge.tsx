/**
 * Pill-shaped status badge per Stitch design system:
 *   - small (status-badge font: 11px / 600 weight)
 *   - colored background tint + dark text
 *   - always pairs color with a leading "•" dot for accessibility
 *
 * Tone presets map domain status enums → semantic colors.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone =
  | "success"   // active, valid, completed
  | "warning"  // pending, expiring, in_progress
  | "danger"   // suspended, revoked, breach
  | "neutral"  // offboarded, inactive, default
  | "violet";  // AI proposed

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-status-success/10 text-status-success border-status-success/30",
  warning: "bg-status-warning/10 text-status-warning border-status-warning/30",
  danger: "bg-status-danger/10 text-status-danger border-status-danger/30",
  neutral: "bg-surface-container-highest text-on-surface-variant border-border-subtle",
  violet: "bg-proposal-violet/10 text-proposal-violet border-proposal-violet/30",
};

export function StatusBadge({
  tone,
  children,
  className,
  dot = true,
}: {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-status-badge text-status-badge uppercase tracking-wide",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden>•</span> : null}
      {children}
    </span>
  );
}

/* --- Domain helpers: stable mappings used in many tables --------- */

export function WarehouseUserStatusBadge({ value }: { value: string }) {
  const tone: BadgeTone =
    value === "active" ? "success"
    : value === "pending" ? "warning"
    : value === "suspended" ? "danger"
    : "neutral";
  return <StatusBadge tone={tone}>{value}</StatusBadge>;
}

export function AccessStatusBadge({ value }: { value: string }) {
  const tone: BadgeTone =
    value === "active" ? "success"
    : value === "revoked" ? "danger"
    : "warning";
  return <StatusBadge tone={tone}>{value}</StatusBadge>;
}

export function CertificateStatusBadge({ value }: { value: string }) {
  const tone: BadgeTone =
    value === "valid" ? "success"
    : value === "expired" ? "warning"
    : "danger";
  return <StatusBadge tone={tone}>{value}</StatusBadge>;
}

export function ProposalStatusBadge({ value }: { value: string }) {
  const tone: BadgeTone =
    value === "approved" ? "success"
    : value === "pending" ? "violet"
    : value === "rejected" ? "danger"
    : "neutral";
  return <StatusBadge tone={tone}>{value}</StatusBadge>;
}

export function ChecklistStatusBadge({ value }: { value: string }) {
  return (
    <StatusBadge tone={value === "completed" ? "success" : "warning"}>
      {value === "in_progress" ? "in progress" : value}
    </StatusBadge>
  );
}

export function OperatorRoleBadge({ value }: { value: string }) {
  const tone: BadgeTone =
    value === "warehouse_admin" ? "violet"
    : value === "hr" ? "success"
    : "neutral";
  return (
    <StatusBadge tone={tone} dot={false}>
      {value.replace("_", " ")}
    </StatusBadge>
  );
}
