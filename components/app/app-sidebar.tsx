"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import type { Operator } from "@/lib/auth/operator";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  match: (path: string) => boolean;
  roles?: ReadonlyArray<Operator["operatorRole"]>;
};

const PRIMARY: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "dashboard",
    match: (p) => p === "/dashboard",
  },
  {
    href: "/warehouse-users",
    label: "Workforce",
    icon: "group",
    match: (p) => p.startsWith("/warehouse-users"),
  },
  {
    href: "/access",
    label: "Access",
    icon: "key",
    match: (p) => p.startsWith("/access"),
  },
  {
    href: "/certificates",
    label: "Certificates",
    icon: "verified",
    match: (p) => p.startsWith("/certificates"),
  },
  {
    href: "/checklists",
    label: "Checklists",
    icon: "fact_check",
    match: (p) => p.startsWith("/checklists"),
  },
  {
    href: "/ai",
    label: "AI Assistant",
    icon: "auto_awesome",
    match: (p) => p.startsWith("/ai"),
  },
  {
    href: "/proposals",
    label: "Proposals",
    icon: "smart_toy",
    match: (p) => p.startsWith("/proposals"),
  },
  {
    href: "/anomalies",
    label: "Anomalies",
    icon: "report",
    match: (p) => p.startsWith("/anomalies"),
  },
  {
    href: "/audit",
    label: "Audit log",
    icon: "history",
    match: (p) => p.startsWith("/audit"),
  },
];

const SECONDARY: NavItem[] = [
  {
    href: "/admin",
    label: "Admin",
    icon: "settings",
    match: (p) => p.startsWith("/admin"),
    roles: ["warehouse_admin"],
  },
];

export function AppSidebar({
  operator,
}: {
  operator: Operator;
}) {
  const pathname = usePathname() ?? "/dashboard";
  const isActive = (item: NavItem) =>
    typeof item.match === "function" ? item.match(pathname) : pathname === item.href;
  const visible = (list: NavItem[]) =>
    list.filter((i) => !i.roles || i.roles.includes(operator.operatorRole));

  return (
    <nav className="bg-surface-container-low border-r border-border-subtle w-sidebar fixed left-0 top-0 bottom-0 flex flex-col z-30 pt-5">
      <div className="px-gutter mb-6">
        <h1 className="font-headline text-headline text-primary">Warehouse UserHub</h1>
        <p className="font-label text-label text-on-surface-variant mt-1">Main Menu</p>
        <p className="font-label text-label text-outline mt-0.5" style={{ fontSize: "10px" }}>v0.1.0</p>
      </div>

      <ul className="flex-1 overflow-y-auto px-3 space-y-0.5">
        {visible(PRIMARY).map((item) => (
          <SidebarLink key={item.href} item={item} active={isActive(item)} />
        ))}
      </ul>

      {visible(SECONDARY).length > 0 ? (
        <div className="mt-2 border-t border-border-subtle pt-2 px-3 space-y-0.5">
          {visible(SECONDARY).map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </div>
      ) : null}

      <div className="border-t border-border-subtle p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant">
            <Icon name="person" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-body-sm text-body-sm font-medium text-on-surface truncate">
              {operator.fullName}
            </div>
            <div className="font-label text-label text-on-surface-variant truncate">
              {operator.email}
            </div>
          </div>
        </div>
        <form action="/logout" method="post" className="mt-2">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded border border-border-subtle font-label text-label text-on-surface-variant hover:bg-surface-container-high transition-colors"
          >
            <Icon name="logout" size={16} /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 px-3 h-9 rounded font-label text-label transition-colors",
          active
            ? "bg-surface-container-high text-primary font-bold border-r-4 border-primary"
            : "text-on-surface-variant hover:bg-surface-container-highest",
        )}
      >
        <Icon name={item.icon} size={20} fill={active} />
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
