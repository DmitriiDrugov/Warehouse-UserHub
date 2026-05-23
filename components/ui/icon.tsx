/**
 * Material Symbols Outlined wrapper. Matches the Stitch design system
 * (which uses `<span class="material-symbols-outlined">name</span>`).
 *
 * Use `size` for visual size, `fill` for the filled variant.
 */

import { cn } from "@/lib/cn";

type Props = {
  name: string;
  className?: string;
  size?: 14 | 16 | 18 | 20 | 24 | 28 | 32;
  fill?: boolean;
  weight?: 300 | 400 | 500 | 600 | 700;
};

export function Icon({ name, className, size = 20, fill = false, weight = 400 }: Props) {
  return (
    <span
      className={cn("material-symbols-outlined leading-none align-middle select-none", className)}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
