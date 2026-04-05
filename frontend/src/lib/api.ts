import { auth } from "@/lib/firebase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function getAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }
  const token = await user.getIdToken(true); // force refresh
  return { Authorization: `Bearer ${token}` };
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const authHeader = await getAuthHeader();
  const url = `${API_BASE.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(options.headers);
  headers.set("Authorization", authHeader.Authorization);
  if (options.body && !(options.body instanceof FormData)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  return fetch(url, { ...options, headers });
}

export type StatsResponse = {
  total_transactions: number;
  total_flagged: number;
  fraud_type_breakdown: Record<string, number>;
  risk_distribution: Record<string, number>;
  last_updated: string | null;
};

export type AlertItem = {
  entity_id: string;
  risk_score: number;
  fraud_types: string[];
  explanation: string;
  timestamp: string | null;
};

export type AlertsResponse = {
  alerts: AlertItem[];
};

export type GraphNodeData = {
  id: string;
  type: string;
  risk_score?: number | null;
  flagged: boolean;
};

export type GraphEdgeData = {
  source: string;
  target: string;
  label: string;
};

export type GraphResponse = {
  nodes: { data: GraphNodeData }[];
  edges: { data: GraphEdgeData }[];
};

export type EntityProfileResponse = {
  entity_id: string;
  entity_type: string;
  neighborhood: Record<string, unknown>;
  risk_score?: number | null;
  fraud_types: string[];
  explanation?: string | null;
  flagged?: boolean | null;
};

export type UploadCSVResponse = {
  total_rows: number;
  flagged_count: number;
  fraud_types: Record<string, number>;
  tigergraph_load?: Record<string, unknown> | null;
  graph_queries_ok: boolean;
};

export type AnalyzeTransactionPayload = {
  amount: number;
  timestamp?: string | null;
  from_account?: string | null;
  to_account?: string | null;
  device_id?: string | null;
  ip_id?: string | null;
};

export type AnalyzeTransactionResponse = {
  risk_score: number;
  fraud_types: string[];
  explanation: string;
  flagged: boolean;
};

export async function getStats(): Promise<StatsResponse> {
  const res = await apiFetch("/stats");
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<StatsResponse>;
}

export async function getAlerts(): Promise<AlertItem[]> {
  const res = await apiFetch("/alerts");
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = (await res.json()) as AlertsResponse;
  return data.alerts ?? [];
}

export async function getGraph(entityId: string): Promise<GraphResponse> {
  const enc = encodeURIComponent(entityId);
  const res = await apiFetch(`/graph/${enc}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<GraphResponse>;
}

export async function getEntity(
  entityId: string
): Promise<EntityProfileResponse> {
  const enc = encodeURIComponent(entityId);
  const res = await apiFetch(`/entity/${enc}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<EntityProfileResponse>;
}

export async function uploadCSV(file: File): Promise<UploadCSVResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const authHeader = await getAuthHeader();
  const url = `${API_BASE.replace(/\/$/, "")}/upload-csv`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader.Authorization },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<UploadCSVResponse>;
}

export async function analyzeTransaction(
  data: AnalyzeTransactionPayload
): Promise<AnalyzeTransactionResponse> {
  const res = await apiFetch("/analyze-transaction", {
    method: "POST",
    body: JSON.stringify({
      amount: data.amount,
      timestamp: data.timestamp ?? undefined,
      from_account: data.from_account ?? undefined,
      to_account: data.to_account ?? undefined,
      device_id: data.device_id ?? undefined,
      ip_id: data.ip_id ?? undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<AnalyzeTransactionResponse>;
}
