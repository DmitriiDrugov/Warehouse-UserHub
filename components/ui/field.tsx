/**
 * Form-field primitives. All inputs share the same shell so the styling
 * is consistent across pages without depending on a forms plugin.
 */

import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

const INPUT_BASE =
  "w-full bg-surface-container-lowest border border-outline-variant rounded h-9 px-3 text-body-sm text-on-surface " +
  "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-on-surface-variant/60";

export function Field({
  label,
  children,
  required,
  hint,
  error,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-label text-label text-on-surface">
        {label} {required ? <span className="text-status-danger">*</span> : null}
      </span>
      {children}
      {hint && !error ? (
        <span className="font-label text-label text-on-surface-variant">{hint}</span>
      ) : null}
      {error ? (
        <span className="font-label text-label text-status-danger">{error}</span>
      ) : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT_BASE, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(INPUT_BASE, "pr-8", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full bg-surface-container-lowest border border-border-subtle rounded px-3 py-2 text-body-sm text-on-surface",
        "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/60",
        props.className,
      )}
    />
  );
}
