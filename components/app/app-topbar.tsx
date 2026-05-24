import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { ModelSelectorDropdown } from "@/components/ui/model-selector";
import type { Operator } from "@/lib/auth/operator";

export function AppTopBar({ operator }: { operator: Operator }) {
  const initials =
    operator.fullName
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <header className="bg-surface-container-lowest border-b border-border-subtle h-14 sticky top-0 z-20 px-gutter flex items-center justify-between">
      <div className="flex items-center gap-4 flex-1 max-w-2xl">
        <Link href="/dashboard" className="md:hidden flex items-center gap-2 text-on-surface">
          <Icon name="warehouse" size={24} className="text-primary" />
        </Link>
        <div className="hidden md:block font-headline text-headline text-on-surface font-bold tracking-tight">
          Warehouse UserHub
        </div>
        <div className="relative flex-1 max-w-sm hidden sm:block">
          <Icon
            name="search"
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          />
          <input
            type="search"
            placeholder="Search workers, IDs…"
            className="w-full bg-surface-container-low border border-transparent rounded-full h-9 pl-9 pr-4 text-body-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <ModelSelectorDropdown />
        <div className="flex items-center gap-1">
          <Link
            href="/proposals"
            className="relative p-2 rounded-full text-on-surface-variant hover:bg-surface-container-low transition-colors"
            title="Proposals inbox"
          >
            <Icon name="notifications" size={20} />
          </Link>
          <Link
            href="/audit"
            className="p-2 rounded-full text-on-surface-variant hover:bg-surface-container-low transition-colors hidden sm:flex"
            title="Audit log"
          >
            <Icon name="history" size={20} />
          </Link>
          <Link
            href="/admin"
            className="p-2 rounded-full text-on-surface-variant hover:bg-surface-container-low transition-colors hidden sm:flex"
            title="Settings"
          >
            <Icon name="apps" size={20} />
          </Link>
          <span className="mx-2 h-6 w-px bg-border-subtle hidden sm:block" />
          <div
            className="w-8 h-8 rounded-full bg-primary-fixed-dim text-on-primary-fixed font-medium text-label flex items-center justify-center border border-border-subtle shrink-0"
            title={`${operator.fullName} · ${operator.operatorRole}`}
          >
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}
