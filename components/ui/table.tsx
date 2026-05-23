/**
 * Data table primitives matching the Stitch design system:
 *   - small medium-weight muted headers
 *   - body-sm cells, hairline horizontal rules (NO zebra striping)
 *   - tabular-nums on numeric / ID columns via `mono` prop
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function DataTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border border-border-subtle rounded-lg bg-surface-container-lowest overflow-x-auto",
        className,
      )}
    >
      <table className="w-full text-left">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "font-label text-label text-on-surface-variant font-semibold",
        "px-4 py-3 border-b border-border-subtle whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  mono = false,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  mono?: boolean;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 border-b border-border-subtle text-table-cell text-on-surface align-top",
        mono && "font-data-mono text-data-mono tabular-nums",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function EmptyRow({
  colSpan,
  children = "No rows match.",
}: {
  colSpan: number;
  children?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-on-surface-variant text-body-sm">
        {children}
      </td>
    </tr>
  );
}
