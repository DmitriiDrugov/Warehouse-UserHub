/**
 * Tiny `cn` (classnames) helper. Joins truthy class names with spaces.
 * Designed to be dependency-free (no clsx / tailwind-merge in this build).
 */

export function cn(
  ...inputs: Array<string | number | false | null | undefined>
): string {
  let out = "";
  for (const v of inputs) {
    if (!v && v !== 0) continue;
    if (out.length > 0) out += " ";
    out += String(v);
  }
  return out;
}
