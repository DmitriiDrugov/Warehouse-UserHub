/**
 * Surface card: white panel on the page background, hairline border, soft
 * rounded corner. Standard radius is 8px (container radius from the
 * design-md). Use `tone="violet"` for the AI-proposal treatment.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({
  children,
  className,
  tone = "default",
  padding = "p-5",
  id,
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "violet" | "danger";
  padding?: string;
  id?: string;
}) {
  const toneClass =
    tone === "violet"
      ? "bg-proposal-violet-soft border-proposal-violet border-dashed"
      : tone === "danger"
        ? "bg-error-container/30 border-status-danger"
        : "bg-surface-container-lowest border-border-subtle";
  return (
    <div id={id} className={cn("border rounded-lg shadow-sm", toneClass, padding, className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-4", className)}>
      <div>
        <h3 className="font-title text-title text-on-surface">{title}</h3>
        {subtitle ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
