/**
 * Standard page header: display-size title + body-sm subtitle, optional
 * right-aligned actions row. Matches the Stitch Dashboard / Workforce
 * page header pattern.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function PageHeader({
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
    <header className={cn("mb-6 flex items-end justify-between gap-4 flex-wrap", className)}>
      <div>
        <h1 className="font-display text-display text-on-surface">{title}</h1>
        {subtitle ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </header>
  );
}
