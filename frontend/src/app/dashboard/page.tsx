"use client";

import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AlertItem,
  type StatsResponse,
  getAlerts,
  getStats,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const BG_CARD = "#161B22";
const BORDER = "#21262D";
const TEXT = "#E6EDF3";
const MUTED = "#8B949E";
const RED = "#EF4444";
const BLUE = "#3B82F6";
const ORANGE = "#F59E0B";
const GREEN = "#10B981";
const GRAY_BAR = "#6B7280";

const PIE_COLORS: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH: "#F59E0B",
  MEDIUM: "#EAB308",
  LOW: "#6B7280",
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0 },
};

function riskGlowClass(score: number) {
  if (score > 80)
    return "shadow-[0_0_0_1px_rgba(239,68,68,0.3)]";
  if (score > 60)
    return "shadow-[0_0_0_1px_rgba(245,158,11,0.25)]";
  return "";
}

function riskLabelFromScore(score: number): string {
  if (score > 80) return "CRITICAL";
  if (score > 60) return "HIGH";
  if (score > 40) return "MEDIUM";
  return "LOW";
}

function riskBadgeStyle(score: number) {
  const label = riskLabelFromScore(score);
  const base =
    "inline-flex items-center border px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums";
  if (label === "CRITICAL")
    return cn(
      base,
      "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#F87171]"
    );
  if (label === "HIGH")
    return cn(
      base,
      "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FBBF24]"
    );
  if (label === "MEDIUM")
    return cn(
      base,
      "border-[#EAB308]/35 bg-[#EAB308]/10 text-[#FDE047]"
    );
  return cn(
    base,
    "border-[#30363D] bg-[#21262D]/80 text-[#8B949E]"
  );
}

export default function DashboardOverviewPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recent, setRecent] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [s, a] = await Promise.all([getStats(), getAlerts()]);
    setStats(s);
    setRecent(a.slice(0, 6));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  const barData = useMemo(() => {
    if (!stats) return [];
    const normal = Math.max(
      0,
      stats.total_transactions - stats.total_flagged
    );
    const rows: { name: string; value: number; fraud: boolean }[] = [
      { name: "Normal", value: normal, fraud: false },
    ];
    const breakdown = Object.entries(stats.fraud_type_breakdown)
      .map(([name, value]) => ({ name, value, fraud: true }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    rows.push(...breakdown);
    return rows;
  }, [stats]);

  const pieData =
    stats &&
    Object.entries(stats.risk_distribution).map(([name, value]) => ({
      name,
      value,
    }));

  const detectionRate =
    stats && stats.total_transactions > 0
      ? ((stats.total_flagged / stats.total_transactions) * 100).toFixed(1)
      : "0.0";

  const highRiskCount = stats
    ? (stats.risk_distribution.HIGH ?? 0) +
      (stats.risk_distribution.CRITICAL ?? 0)
    : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton
          className="h-9 w-72 rounded-sm border border-[#21262D]"
          style={{ backgroundColor: "#161B22" }}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[88px] rounded-sm border border-[#21262D]"
              style={{ backgroundColor: "#161B22" }}
            />
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton
            className="h-[280px] rounded-sm border border-[#21262D]"
            style={{ backgroundColor: "#161B22" }}
          />
          <Skeleton
            className="h-[280px] rounded-sm border border-[#21262D]"
            style={{ backgroundColor: "#161B22" }}
          />
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div
        className="rounded-sm border p-4 text-sm"
        style={{
          borderColor: "rgba(239,68,68,0.35)",
          backgroundColor: "rgba(239,68,68,0.08)",
          color: "#F87171",
        }}
      >
        {error ?? "No data"}
      </div>
    );
  }

  const updatedStr = stats.last_updated
    ? new Date(stats.last_updated).toLocaleString()
    : "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="text-lg font-semibold tracking-tight"
            style={{ color: TEXT }}
          >
            Threat Overview
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
            Live posture across uploaded transactions and graph-derived signals.
          </p>
          <p className="mt-1 font-mono text-[11px]" style={{ color: MUTED }}>
            Last updated: {updatedStr}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={handleRefresh}
          className="h-8 shrink-0 gap-2 rounded-sm border-[#30363D] bg-[#161B22] text-xs text-[#E6EDF3] hover:bg-[#21262D]"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <motion.div variants={item}>
          <StatCard
            title="Total transactions"
            value={stats.total_transactions.toLocaleString()}
            trend="↑ 3.2% from last scan"
            trendTone="neutral"
            borderColor={BLUE}
            icon={<Activity className="h-4 w-4" style={{ color: BLUE }} />}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            title="Fraud flagged"
            value={stats.total_flagged.toLocaleString()}
            trend="↑ 12% from last scan"
            trendTone="bad"
            borderColor={RED}
            icon={
              <AlertTriangle className="h-4 w-4" style={{ color: RED }} />
            }
            valueClass="text-[#F87171]"
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            title="High + critical"
            value={highRiskCount.toLocaleString()}
            trend="↓ 4% from last scan"
            trendTone="good"
            borderColor={ORANGE}
            icon={<Shield className="h-4 w-4" style={{ color: ORANGE }} />}
            valueClass="text-[#FBBF24]"
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            title="Detection rate"
            value={`${detectionRate}%`}
            trend="↑ 0.8pp from last scan"
            trendTone="good"
            borderColor={GREEN}
            icon={<TrendingUp className="h-4 w-4" style={{ color: GREEN }} />}
            valueClass="text-[#34D399]"
          />
        </motion.div>
      </motion.div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section
          className="rounded-sm border p-3"
          style={{ backgroundColor: BG_CARD, borderColor: BORDER }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: TEXT }}>
              Volume by signal
            </h2>
            <span
              className="font-mono text-[11px]"
              style={{ color: MUTED }}
            >
              Last 7 days
            </span>
          </div>
          <div className="h-[260px] w-full">
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ left: 4, right: 8, top: 4, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#30363D"
                    horizontal={false}
                  />
                  <XAxis type="number" stroke={MUTED} fontSize={10} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={108}
                    stroke={MUTED}
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(v) =>
                      String(v).length > 16
                        ? `${String(v).slice(0, 14)}…`
                        : String(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    contentStyle={{
                      background: "#0D1117",
                      border: `1px solid ${BORDER}`,
                      borderRadius: 2,
                      fontSize: 12,
                      color: TEXT,
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 1, 1, 0]} maxBarSize={22}>
                    {barData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.fraud ? RED : GRAY_BAR}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[13px]" style={{ color: MUTED }}>
                No breakdown yet. Upload a dataset to populate charts.
              </p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 border-t border-[#21262D] pt-2 text-[10px]" style={{ color: MUTED }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: RED }} />
              Fraud / signal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[1px]" style={{ backgroundColor: GRAY_BAR }} />
              Normal volume
            </span>
          </div>
        </section>

        <section
          className="rounded-sm border p-3"
          style={{ backgroundColor: BG_CARD, borderColor: BORDER }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: TEXT }}>
              Risk distribution
            </h2>
            <span className="font-mono text-[11px]" style={{ color: MUTED }}>
              Last 7 days
            </span>
          </div>
          <div className="h-[260px] w-full">
            {pieData && pieData.some((d) => d.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={1}
                    stroke="#21262D"
                    strokeWidth={1}
                    label={({ name, percent }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    fontSize={11}
                    fill={TEXT}
                  >
                    {pieData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[entry.name] ?? "#6B7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#0D1117",
                      border: `1px solid ${BORDER}`,
                      borderRadius: 2,
                      fontSize: 12,
                      color: TEXT,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[13px]" style={{ color: MUTED }}>
                No distribution data.
              </p>
            )}
          </div>
        </section>
      </div>

      <section
        className="rounded-sm border"
        style={{ backgroundColor: BG_CARD, borderColor: BORDER }}
      >
        <div className="flex items-center justify-between border-b border-[#21262D] px-3 py-2">
          <h2 className="text-[13px] font-semibold" style={{ color: TEXT }}>
            Recent alerts
          </h2>
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>
            Top {recent.length} by score
          </span>
        </div>
        <div className="divide-y divide-[#21262D]">
          {recent.length === 0 ? (
            <p className="px-3 py-6 text-[13px]" style={{ color: MUTED }}>
              No alerts in queue. Scores above 60 appear here after ingest.
            </p>
          ) : (
            recent.map((a) => (
              <div
                key={a.entity_id}
                className={cn(
                  "flex flex-wrap items-start gap-3 px-3 py-2.5 transition-colors hover:bg-[#0D1117]/50",
                  riskGlowClass(a.risk_score)
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="font-mono text-[12px] font-medium"
                      style={{ color: TEXT }}
                    >
                      {a.entity_id}
                    </span>
                    <span className={riskBadgeStyle(a.risk_score)}>
                      {riskLabelFromScore(a.risk_score)}{" "}
                      <span className="opacity-80">
                        {a.risk_score.toFixed(1)}
                      </span>
                    </span>
                  </div>
                  <p
                    className="mt-1 line-clamp-2 text-[12px] leading-snug"
                    style={{ color: MUTED }}
                  >
                    {a.explanation}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  title,
  value,
  trend,
  trendTone,
  borderColor,
  icon,
  valueClass,
}: {
  title: string;
  value: string;
  trend: string;
  trendTone: "good" | "bad" | "neutral";
  borderColor: string;
  icon: React.ReactNode;
  valueClass?: string;
}) {
  const trendColor =
    trendTone === "good"
      ? "#34D399"
      : trendTone === "bad"
        ? "#F87171"
        : MUTED;
  return (
    <div
      className="relative rounded-sm border p-3 pl-3.5"
      style={{
        backgroundColor: BG_CARD,
        borderColor: BORDER,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
      }}
    >
      <div className="absolute right-2.5 top-2.5 opacity-90">{icon}</div>
      <p className="pr-8 text-[11px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>
        {title}
      </p>
      <p
        className={cn(
          "mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight",
          valueClass
        )}
        style={{ color: valueClass ? undefined : TEXT }}
      >
        {value}
      </p>
      <p
        className="mt-1.5 font-mono text-[10px] tabular-nums"
        style={{ color: trendColor }}
      >
        {trend}
      </p>
    </div>
  );
}
