/**
 * Source tag — smaller than a StatusBadge, neutral grey, shows where an
 * access grant came from: Manual / Role Template / Temporary Project.
 */

import { cn } from "@/lib/cn";

const LABEL: Record<string, string> = {
  role_template: "Role Template",
  manual: "Manual",
  temporary_project: "Temporary",
};

export function SourceTag({ value, className }: { value: string; className?: string }) {
  const text = LABEL[value] ?? value;
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded font-label text-label",
        "bg-surface-container-high text-on-surface-variant border border-border-subtle",
        className,
      )}
    >
      {text}
    </span>
  );
}
