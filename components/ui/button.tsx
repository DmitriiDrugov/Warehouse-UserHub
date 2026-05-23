/**
 * Buttons matching the Stitch design system.
 *
 *   variant="primary"  → solid primary blue
 *   variant="secondary"→ solid white with hairline border
 *   variant="ghost"    → text-only
 *   variant="danger"   → solid danger red
 *   variant="violet"   → solid violet (approval action for AI proposals)
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "violet";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-container border-primary",
  secondary:
    "bg-surface-container-lowest text-on-surface hover:bg-surface-container-low border-border-subtle",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-container border-transparent",
  danger:
    "bg-status-danger text-white hover:opacity-90 border-status-danger",
  violet:
    "bg-proposal-violet text-white hover:opacity-90 border-proposal-violet",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-label",
  md: "h-9 px-4 text-label",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  block,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded border font-label whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}
