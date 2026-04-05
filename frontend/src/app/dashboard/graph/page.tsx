"use client";

import type { Core, StylesheetJson } from "cytoscape";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type GraphResponse, getGraph } from "@/lib/api";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
}) as React.ComponentType<{
  elements: ReturnType<typeof buildElements>;
  stylesheet: StylesheetJson;
  layout: Record<string, string | number | boolean>;
  style: React.CSSProperties;
  cy?: (cy: Core) => void;
}>;

function edgeCategory(label: string): string {
  const u = label.toUpperCase();
  if (
    u.includes("MADE_TRANSACTION") ||
    u.includes("RECEIVED_BY") ||
    u.includes("TRANSACTION")
  ) {
    return "txn";
  }
  if (
    u.includes("USES_DEVICE") ||
    u.includes("SHARES_DEVICE") ||
    u.includes("DEVICE")
  ) {
    return "device";
  }
  if (u.includes("CONNECTED_FROM") || u.includes("IP")) {
    return "ip";
  }
  if (u.includes("OWNS_ACCOUNT")) {
    return "txn";
  }
  return "other";
}

function buildElements(graph: GraphResponse) {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    const s = e.data.source;
    const t = e.data.target;
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
  }

  const nodes = graph.nodes.map((n) => {
    const d = n.data;
    const deg = degree.get(d.id) ?? 0;
    const rs = d.risk_score ?? 0;
    const flagged = Boolean(d.flagged) || rs > 60;
    let cls = "clean";
    if (flagged) cls = "flagged";
    else if (rs > 40) cls = "medium";
    return {
      data: {
        id: d.id,
        label: d.id,
        type: d.type,
        degree: deg,
        risk_score: rs,
        flagged,
      },
      classes: cls,
    };
  });

  const edges = graph.edges.map((e, i) => ({
    data: {
      id: `e-${i}-${e.data.source}-${e.data.target}`,
      source: e.data.source,
      target: e.data.target,
      label: e.data.label,
    },
    classes: edgeCategory(e.data.label),
  }));

  return [...nodes, ...edges];
}

const STYLESHEET: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 9,
      color: "#e2e8f0",
      "text-outline-width": 2,
      "text-outline-color": "#0f172a",
      width: "mapData(degree, 0, 12, 28, 72)",
      height: "mapData(degree, 0, 12, 28, 72)",
    },
  },
  {
    selector: "node.clean",
    style: { "background-color": "#64748b" },
  },
  {
    selector: "node.medium",
    style: { "background-color": "#f97316" },
  },
  {
    selector: "node.flagged",
    style: { "background-color": "#ef4444" },
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "line-color": "#475569",
      "target-arrow-color": "#475569",
      opacity: 0.85,
    },
  },
  {
    selector: "edge.txn",
    style: {
      "line-color": "#3b82f6",
      "target-arrow-color": "#3b82f6",
    },
  },
  {
    selector: "edge.device",
    style: {
      "line-color": "#a855f7",
      "target-arrow-color": "#a855f7",
    },
  },
  {
    selector: "edge.ip",
    style: {
      "line-color": "#22c55e",
      "target-arrow-color": "#22c55e",
    },
  },
  {
    selector: "edge.other",
    style: {
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
    },
  },
];

export default function GraphExplorerPage() {
  const searchParams = useSearchParams();
  const [entityId, setEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null
  );

  const loadGraphForEntity = useCallback(async (trimmed: string) => {
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setGraph(null);
    setSelected(null);
    try {
      const g = await getGraph(trimmed);
      setGraph(g);
      if (!g.nodes?.length) {
        setError("No nodes returned for this entity.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  const entityParam = searchParams.get("entity");
  useEffect(() => {
    const q = entityParam?.trim();
    if (!q) return;
    setEntityId(q);
    void loadGraphForEntity(q);
  }, [entityParam, loadGraphForEntity]);

  const elements = useMemo(
    () => (graph ? buildElements(graph) : []),
    [graph]
  );

  const bindCy = useCallback((cy: Core) => {
    cy.removeListener("tap", "node");
    cy.removeListener("tap");
    cy.on("tap", "node", (evt) => {
      setSelected(evt.target.data() as Record<string, unknown>);
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        setSelected(null);
      }
    });
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = entityId.trim();
    if (!trimmed) return;
    await loadGraphForEntity(trimmed);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">
          Graph explorer
        </h1>
        <p className="text-sm text-slate-500">
          2-hop neighborhood for an Account. Click a node for details.
        </p>
      </div>

      <form
        onSubmit={handleSearch}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium text-slate-500">
            Entity ID (Account)
          </label>
          <Input
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="e.g. account id from your dataset"
            className="border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600"
          />
        </div>
        <Button
          type="submit"
          disabled={loading || !entityId.trim()}
          className="bg-blue-600 hover:bg-blue-500"
        >
          Load graph
        </Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-100">Network</CardTitle>
            <CardDescription className="text-slate-500">
              Cytoscape.js layout (cose)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            {loading && (
              <Skeleton className="h-[520px] w-full rounded-lg bg-slate-800" />
            )}
            {!loading && !graph && !error && (
              <div className="flex h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center">
                <p className="text-slate-300">No graph loaded</p>
                <p className="mt-2 max-w-md text-sm text-slate-500">
                  Enter an Account ID that exists in TigerGraph (same as used
                  when loading CSV with account_id / graph edges).
                </p>
              </div>
            )}
            {!loading && graph && elements.length > 0 && (
              <CytoscapeComponent
                elements={elements}
                stylesheet={STYLESHEET}
                layout={{ name: "cose", idealEdgeLength: 120, nodeOverlap: 16 }}
                style={{ width: "100%", height: "520px", background: "#020617" }}
                cy={bindCy}
              />
            )}
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-slate-100">Legend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-slate-400">
              <div>
                <p className="mb-1 font-medium text-slate-300">Nodes</p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500" />{" "}
                    Flagged / risk &gt; 60
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-orange-500" />{" "}
                    Medium risk
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-slate-500" />{" "}
                    Clean
                  </li>
                </ul>
                <p className="mt-2 text-slate-500">
                  Size scales with connection count.
                </p>
              </div>
              <div>
                <p className="mb-1 font-medium text-slate-300">Edges</p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="h-0.5 w-6 bg-blue-500" /> Transaction flow
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-0.5 w-6 bg-purple-500" /> Device
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-0.5 w-6 bg-emerald-500" /> IP
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-slate-100">
                Selection
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selected ? (
                <dl className="space-y-2 text-xs text-slate-300">
                  {Object.entries(selected).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-mono break-all text-slate-200">
                        {String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-slate-500">
                  Click a node to inspect attributes.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
