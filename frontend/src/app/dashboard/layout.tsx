"use client";

import {
  AlertTriangle,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Network,
  Search,
  Shield,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/dashboard/graph", label: "Graph Explorer", icon: Network },
  { href: "/dashboard/entity", label: "Entity Search", icon: Search },
  { href: "/dashboard/upload", label: "Upload Data", icon: Upload },
] as const;

function breadcrumbsFor(pathname: string): { href: string; label: string }[] {
  const base = [{ href: "/dashboard", label: "FraudNet" }];
  if (pathname === "/dashboard") {
    return [...base, { href: "/dashboard", label: "Overview" }];
  }
  const seg = pathname.replace("/dashboard", "").split("/").filter(Boolean);
  const labels: Record<string, string> = {
    alerts: "Alerts",
    graph: "Graph Explorer",
    entity: "Entity Search",
    upload: "Upload Data",
  };
  const rest = seg.map((s) => ({
    href: `/dashboard/${s}`,
    label: labels[s] ?? s,
  }));
  return [...base, ...rest];
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const crumbs = useMemo(() => breadcrumbsFor(pathname), [pathname]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
      if (!u) {
        router.replace("/");
      }
    });
    return () => unsub();
  }, [router]);

  async function logout() {
    await signOut(auth);
    router.push("/");
  }

  if (!ready || !user) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[#8B949E]"
        style={{ backgroundColor: "#0A0E1A" }}
      >
        <span className="font-mono text-sm">Loading session…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0A0E1A" }}>
      <aside
        className="fixed left-0 top-0 z-40 flex h-full w-56 flex-col border-r border-gray-800"
        style={{ backgroundColor: "#0D1117" }}
      >
        <div className="flex items-center gap-2.5 border-b border-gray-800 px-3 py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#21262D] bg-[#161B22]">
            <Shield
              className="h-4 w-4 text-[#EF4444]"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight text-[#E6EDF3]">
                FraudNet
              </span>
              <span className="shrink-0 rounded border border-[#30363D] bg-[#161B22] px-1.5 py-px font-mono text-[10px] font-medium text-[#8B949E]">
                v1.0
              </span>
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-px p-2">
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 border-l-2 border-transparent py-2 pl-2.5 pr-2 text-[13px] font-medium text-[#8B949E] transition-colors",
                  "hover:bg-gray-800/50 hover:text-[#E6EDF3]",
                  active &&
                    "border-[#EF4444] bg-gray-800 text-[#E6EDF3]"
                )}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-gray-800 p-3">
          <div className="flex items-center gap-2 text-[11px] text-[#8B949E]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]"
              aria-hidden
            />
            <span>All systems operational</span>
          </div>
        </div>
      </aside>

      <header
        className="fixed left-56 right-0 top-0 z-30 flex h-12 items-center justify-between border-b border-gray-800 px-4"
        style={{ backgroundColor: "#0D1117" }}
      >
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-[#8B949E]">
          {crumbs.map((c, i) => (
            <span key={`${c.href}-${i}`} className="flex items-center gap-1">
              {i > 0 ? (
                <span className="text-[#30363D]" aria-hidden>
                  /
                </span>
              ) : null}
              {i === crumbs.length - 1 ? (
                <span className="truncate font-medium text-[#E6EDF3]">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="truncate transition-colors hover:text-[#E6EDF3]"
                >
                  {c.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">
            {user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoURL}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-full border border-[#30363D] object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full border border-[#30363D] font-mono text-[11px] font-medium text-[#E6EDF3]"
                style={{ backgroundColor: "#161B22" }}
              >
                {(user.email ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="max-w-[180px] truncate font-mono text-xs text-[#8B949E]">
              {user.email}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 text-[#8B949E]"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded border-[#30363D] bg-[#161B22] px-2 text-xs text-[#E6EDF3] hover:bg-[#21262D]"
            onClick={logout}
          >
            <LogOut className="h-3 w-3" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main
        className="ml-56 min-h-screen border-l border-transparent px-4 py-3 pt-[3.25rem] md:px-5"
        style={{ backgroundColor: "#0A0E1A" }}
      >
        {children}
      </main>
    </div>
  );
}
