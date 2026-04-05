"use client";

import { Download, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type AlertItem, getAlerts } from "@/lib/api";
import { cn } from "@/lib/utils";

const BORDER = "#21262D";
const CARD = "#161B22";
const PANEL = "#0D1117";

type RiskFilter = "all" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

function severityFromScore(score: number): RiskFilter {
  if (score > 80) return "CRITICAL";
  if (score > 60) return "HIGH";
  if (score > 40) return "MEDIUM";
  return "LOW";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 172800) return "1d ago";
  return `${Math.floor(sec / 86400)}d ago`;
}

function fraudTagClass(t: string): string {
  const u = t.toUpperCase();
  if (u.includes("CYCLE") || u.includes("FLOW"))
    return "border-[#EF4444]/40 bg-[#EF4444]/12 text-[#F87171]";
  if (u.includes("DEVICE") || u.includes("SHARED"))
    return "border-[#F59E0B]/40 bg-[#F59E0B]/12 text-[#FBBF24]";
  if (u.includes("ML") || u.includes("ANOMALY"))
    return "border-[#3B82F6]/40 bg-[#3B82F6]/12 text-[#60A5FA]";
  return "border-[#30363D] bg-[#21262D] text-[#8B949E]";
}

function exportAlertsCsv(rows: AlertItem[]) {
  const header = [
    "entity_id",
    "risk_score",
    "severity",
    "fraud_types",
    "explanation",
    "timestamp",
  ];
  const lines = rows.map((a) =>
    [
      a.entity_id,
      String(a.risk_score),
      severityFromScore(a.risk_score),
      a.fraud_types.join(";"),
      JSON.stringify(a.explanation),
      a.timestamp ?? "",
    ].join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fraudnet-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [fraudTypeFilter, setFraudTypeFilter] = useState<string>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<AlertItem | null>(null);

  const load = useCallback(async () => {
    const data = await getAlerts();
    setAlerts(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load alerts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const fraudTypeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of alerts) {
      for (const t of a.fraud_types) {
        if (t) s.add(t);
      }
    }
    return Array.from(s).sort();
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      const sev = severityFromScore(a.risk_score);
      if (riskFilter !== "all" && sev !== riskFilter) return false;
      if (fraudTypeFilter !== "all") {
        const match = a.fraud_types.some(
          (t) => t === fraudTypeFilter
        );
        if (!match) return false;
      }
      if (!q) return true;
      return (
        a.entity_id.toLowerCase().includes(q) ||
        a.explanation.toLowerCase().includes(q) ||
        a.fraud_types.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [alerts, search, riskFilter, fraudTypeFilter]);

  function openDrawer(a: AlertItem) {
    setActive(a);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton
          className="h-9 w-full max-w-lg rounded-sm border border-[#21262D]"
          style={{ backgroundColor: CARD }}
        />
        <Skeleton
          className="h-[420px] w-full rounded-sm border border-[#21262D]"
          style={{ backgroundColor: CARD }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-sm border p-4 text-sm"
        style={{
          borderColor: "rgba(239,68,68,0.35)",
          backgroundColor: "rgba(239,68,68,0.08)",
          color: "#F87171",
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-[#E6EDF3]">
            Active Alerts
          </h1>
          <span className="rounded-sm border border-[#30363D] bg-[#161B22] px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-[#8B949E]">
            {filtered.length}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filtered.length === 0}
          onClick={() => exportAlertsCsv(filtered)}
          className="h-8 gap-2 rounded-sm border-[#30363D] bg-[#161B22] text-xs text-[#E6EDF3] hover:bg-[#21262D]"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      <div
        className="flex flex-col gap-2 rounded-sm border p-2 sm:flex-row sm:flex-wrap sm:items-center"
        style={{ backgroundColor: CARD, borderColor: BORDER }}
      >
        <Input
          placeholder="Search entity ID, explanation, fraud type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-md rounded-sm border-[#30363D] bg-[#0D1117] font-mono text-xs text-[#E6EDF3] placeholder:text-[#6B7280]"
        />
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as RiskFilter)}
          className="h-8 rounded-sm border border-[#30363D] bg-[#0D1117] px-2 text-xs text-[#E6EDF3] outline-none"
        >
          <option value="all">All risk levels</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select
          value={fraudTypeFilter}
          onChange={(e) => setFraudTypeFilter(e.target.value)}
          className="h-8 min-w-[160px] rounded-sm border border-[#30363D] bg-[#0D1117] px-2 text-xs text-[#E6EDF3] outline-none"
        >
          <option value="all">All fraud types</option>
          {fraudTypeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-sm border border-dashed py-16 text-center"
          style={{ borderColor: "#30363D", backgroundColor: "rgba(22,27,34,0.5)" }}
        >
          <p className="text-sm text-[#E6EDF3]">No alerts match filters</p>
          <p className="mt-2 max-w-md text-xs text-[#8B949E]">
            Upload a CSV from Upload Data to score entities. Alerts are entities
            with risk score above 60.
          </p>
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-sm border"
          style={{ borderColor: BORDER, backgroundColor: CARD }}
        >
          <Table>
            <TableHeader>
              <TableRow
                className="border-[#21262D] hover:bg-transparent"
                style={{ borderColor: BORDER }}
              >
                <TableHead className="h-9 w-[100px] text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Severity
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Entity ID
                </TableHead>
                <TableHead className="h-9 w-[140px] text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Risk score
                </TableHead>
                <TableHead className="h-9 text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Fraud type
                </TableHead>
                <TableHead className="h-9 w-[88px] text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Time
                </TableHead>
                <TableHead className="h-9 w-[72px] text-right text-[11px] font-semibold uppercase tracking-wide text-[#8B949E]">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const sev = severityFromScore(a.risk_score);
                const critical = sev === "CRITICAL";
                return (
                  <TableRow
                    key={a.entity_id}
                    className={cn(
                      "cursor-pointer border-[#21262D] transition-colors",
                      critical &&
                        "shadow-[0_0_0_1px_rgba(239,68,68,0.25)]",
                      "hover:bg-[#0D1117]/80"
                    )}
                    onClick={() => openDrawer(a)}
                  >
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full bg-[#6B7280]",
                            sev === "CRITICAL" &&
                              "fraudnet-blink-dot bg-[#EF4444]",
                            sev === "HIGH" && "bg-[#F59E0B]",
                            sev === "MEDIUM" && "bg-[#EAB308]",
                            sev === "LOW" && "bg-[#6B7280]"
                          )}
                          aria-hidden
                        />
                        <span className="font-mono text-[11px] font-medium text-[#E6EDF3]">
                          {sev}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[12px] text-[#E6EDF3]">
                      {a.entity_id}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-[1px] bg-[#21262D]">
                          <div
                            className="h-full rounded-[1px] bg-[#EF4444]"
                            style={{
                              width: `${Math.min(100, a.risk_score)}%`,
                              backgroundColor:
                                a.risk_score > 80
                                  ? "#EF4444"
                                  : a.risk_score > 60
                                    ? "#F59E0B"
                                    : "#3B82F6",
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-[#8B949E]">
                          {a.risk_score.toFixed(0)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px] py-2">
                      <div className="flex flex-wrap gap-1">
                        {(a.fraud_types.length ? a.fraud_types : ["—"]).map(
                          (t) => (
                            <span
                              key={t}
                              className={cn(
                                "inline-block max-w-full truncate border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                                t === "—"
                                  ? "border-[#30363D] text-[#6B7280]"
                                  : fraudTagClass(t)
                              )}
                            >
                              {t}
                            </span>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 font-mono text-[11px] text-[#8B949E]">
                      {formatRelative(a.timestamp)}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-sm px-2 text-[11px] text-[#3B82F6] hover:bg-[#21262D] hover:text-[#60A5FA]"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDrawer(a);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Backdrop */}
      <div
        role="presentation"
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />

      {/* Drawer */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-[60] flex h-full w-full max-w-md flex-col border-l shadow-2xl transition-transform duration-200 ease-out",
          drawerOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{
          backgroundColor: PANEL,
          borderColor: BORDER,
        }}
        aria-hidden={!drawerOpen}
      >
        <div
          className="flex items-center justify-between border-b px-3 py-2.5"
          style={{ borderColor: BORDER }}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#8B949E]">
              Alert detail
            </p>
            <p className="truncate font-mono text-sm font-semibold text-[#E6EDF3]">
              {active?.entity_id ?? "—"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0 rounded-sm text-[#8B949E] hover:bg-[#21262D] hover:text-[#E6EDF3]"
            onClick={closeDrawer}
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {active && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[11px] font-medium",
                  severityFromScore(active.risk_score) === "CRITICAL" &&
                    "text-[#F87171]"
                )}
              >
                Severity{" "}
                <span className="text-[#E6EDF3]">
                  {severityFromScore(active.risk_score)}
                </span>
              </span>
              <span className="font-mono text-[11px] text-[#8B949E]">
                Score{" "}
                <span className="tabular-nums text-[#E6EDF3]">
                  {active.risk_score.toFixed(1)}
                </span>
              </span>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B949E]">
                Fraud types
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {active.fraud_types.map((t) => (
                  <span
                    key={t}
                    className={cn(
                      "border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                      fraudTagClass(t)
                    )}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8B949E]">
                Explanation
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#E6EDF3]">
                {active.explanation}
              </p>
            </div>

            {active.timestamp && (
              <p className="font-mono text-[11px] text-[#8B949E]">
                Observed {new Date(active.timestamp).toLocaleString()}
              </p>
            )}

            <div className="mt-auto border-t pt-3" style={{ borderColor: BORDER }}>
              <Button
                type="button"
                asChild
                className="h-9 w-full rounded-sm border border-[#30363D] bg-[#161B22] text-xs font-medium text-[#E6EDF3] hover:bg-[#21262D]"
              >
                <Link
                  href={`/dashboard/graph?entity=${encodeURIComponent(active.entity_id)}`}
                  onClick={closeDrawer}
                >
                  Open graph preview
                </Link>
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
