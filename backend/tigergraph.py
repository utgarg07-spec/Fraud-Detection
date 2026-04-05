"""
TigerGraph Cloud (v4) helpers for the FraudNet graph via direct REST (Bearer token).
"""

from __future__ import annotations

import datetime
import os
import re
import requests
from collections import defaultdict
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote

import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv()

ALLOWED_VERTEX_TYPES = frozenset(
    {"User", "Account", "Transaction", "Device", "IPAddress"}
)

# (source_type, edge, target_type) for traversing the heterogeneous graph
_EDGE_TRAVERSAL: Tuple[Tuple[str, str, str], ...] = (
    ("User", "OWNS_ACCOUNT", "Account"),
    ("Account", "MADE_TRANSACTION", "Transaction"),
    ("Transaction", "RECEIVED_BY", "Account"),
    ("User", "USES_DEVICE", "Device"),
    ("User", "CONNECTED_FROM", "IPAddress"),
    ("User", "SHARES_DEVICE", "User"),
)


def _normalize_host(raw: str) -> str:
    h = (raw or "").strip()
    h = re.sub(r"^https?://", "", h, flags=re.I).rstrip("/")
    return f"https://{h}"


def _gsql_plain_text(conn: Dict[str, Any], query: str) -> str:
    """Run GSQL on v1 API using Bearer token; plain text body."""
    url = f"{conn['host'].rstrip('/')}/gsql/v1/statements"
    r = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {conn['token']}",
            "Content-Type": "text/plain",
        },
        data=query.encode("utf-8"),
        timeout=180,
    )
    return r.text


def _safe_entity_id(entity_id: str) -> str:
    if not entity_id or not re.match(r"^[a-zA-Z0-9_.\-:@]+$", str(entity_id)):
        raise ValueError("entity_id contains invalid characters")
    return str(entity_id)


def _vertex_record_to_attrs(rec: Any) -> Dict[str, Any]:
    if not isinstance(rec, dict):
        return {}
    attrs = rec.get("attributes")
    if isinstance(attrs, dict):
        return dict(attrs)
    return {k: v for k, v in rec.items() if k not in ("v_id", "v_type")}


def get_tigergraph_token() -> str:
    host = os.getenv("TIGERGRAPH_HOST")
    secret = os.getenv("TIGERGRAPH_SECRET")

    url = f"https://{host}/gsql/v1/tokens"

    for attempt in range(3):
        try:
            response = requests.post(
                url,
                json={"secret": secret},
                timeout=30,
            )
            if response.status_code == 200:
                data = response.json()
                return data["token"]
            print(
                f"[TigerGraph] Token attempt {attempt+1} failed: {response.status_code} {response.text[:100]}"
            )
        except Exception as e:
            print(f"[TigerGraph] Token attempt {attempt+1} exception: {e}")

    raise Exception("Failed to get TigerGraph token after 3 attempts")


def connect_to_tigergraph():
    """
    Returns a simple dict with host + token instead of TigerGraphConnection.
    We bypass pyTigerGraph entirely and use direct REST calls.

    Always requests a new Bearer token via get_tigergraph_token() on each call;
    tokens are not cached here so expiry is handled by obtaining a fresh token
    whenever callers reconnect.
    """
    host = os.getenv("TIGERGRAPH_HOST")
    graph = os.getenv("TIGERGRAPH_GRAPH")
    token = get_tigergraph_token()
    print(f"[TigerGraph] Connected successfully to {host}")
    return {
        "host": f"https://{host}",
        "graph": graph,
        "token": token,
        "headers": {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    }


def tg_get(conn: dict, path: str, params: Optional[dict] = None) -> Any:
    """GET request to TigerGraph REST API (Bearer token)."""
    url = f"{conn['host'].rstrip('/')}{path}"
    response = requests.get(url, headers=conn["headers"], params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def tg_post(conn: dict, path: str, body: Optional[dict] = None) -> Any:
    """POST request to TigerGraph REST API (Bearer token)."""
    url = f"{conn['host'].rstrip('/')}{path}"
    response = requests.post(url, headers=conn["headers"], json=body, timeout=120)
    response.raise_for_status()
    return response.json()


def _attr_json_value(v: Any) -> Dict[str, Any]:
    if v is None:
        return {"value": ""}
    if isinstance(v, float) and pd.isna(v):
        return {"value": 0.0}
    if isinstance(v, bool):
        return {"value": v}
    if isinstance(v, np.bool_):
        return {"value": bool(v)}
    if isinstance(v, (int, np.integer)):
        return {"value": int(v)}
    if isinstance(v, (float, np.floating)):
        return {"value": float(v)}
    if isinstance(v, (datetime.datetime, pd.Timestamp)):
        s = pd.Timestamp(v)
        return {"value": str(s.to_pydatetime())[:19].replace("T", " ")}
    return {"value": str(v)}


def rest_graph_upsert(conn: dict, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST /restpp/graph/{graph} JSON upsert."""
    gn = conn["graph"]
    path = f"/restpp/graph/{quote(str(gn), safe='')}"
    return tg_post(conn, path, payload)


def upsert_vertices_rest(conn: dict, vertex_type: str, vertices: list) -> int:
    if not vertices:
        return 0
    payload: Dict[str, Any] = {vertex_type: {}}
    for vid, attrs in vertices:
        payload[vertex_type][vid] = {
            k: _attr_json_value(v) for k, v in attrs.items()
        }

    g = quote(str(conn["graph"]), safe="")
    url = f"{conn['host'].rstrip('/')}/restpp/graph/{g}"
    response = requests.post(
        url, headers=conn["headers"], json={"vertices": payload}, timeout=30
    )
    response.raise_for_status()
    result = response.json()
    av, _ = _parse_upsert_response(result)
    return av


def upsert_edges_rest(
    conn: dict, src_type: str, edge_type: str, tgt_type: str, edges: list
) -> int:
    if not edges:
        return 0
    payload: Dict[str, Any] = {src_type: {}}
    for src_id, tgt_id, attrs in edges:
        if src_id not in payload[src_type]:
            payload[src_type][src_id] = {edge_type: {tgt_type: {}}}
        payload[src_type][src_id][edge_type][tgt_type][tgt_id] = {
            k: _attr_json_value(v) for k, v in attrs.items()
        }

    g = quote(str(conn["graph"]), safe="")
    url = f"{conn['host'].rstrip('/')}/restpp/graph/{g}"
    response = requests.post(
        url, headers=conn["headers"], json={"edges": payload}, timeout=30
    )
    response.raise_for_status()
    result = response.json()
    _, ae = _parse_upsert_response(result)
    return ae


def _tg_results_rows(data: Any) -> List[dict]:
    if not isinstance(data, dict) or data.get("error"):
        return []
    res = data.get("results")
    if isinstance(res, list):
        return [x for x in res if isinstance(x, dict)]
    if isinstance(res, dict):
        return [res]
    return []


def _parse_upsert_response(j: Any) -> Tuple[int, int]:
    if isinstance(j, dict) and isinstance(j.get("results"), list) and j["results"]:
        blk = j["results"][0]
        if isinstance(blk, dict):
            return int(blk.get("accepted_vertices", 0)), int(blk.get("accepted_edges", 0))
    if isinstance(j, dict):
        return int(j.get("accepted_vertices", 0)), int(j.get("accepted_edges", 0))
    return 0, 0


def create_schema() -> Dict[str, Any]:
    """
    Create FraudNet global vertex/edge types and graph, then install analytic queries.
    Safe to call again: ignores 'already exists' style outcomes where possible.
    """
    print("[TigerGraph] Creating / updating FraudNet schema (GSQL)…")
    try:
        conn = connect_to_tigergraph()

        g = conn["graph"]
        ddl = f"""
USE GLOBAL
CREATE VERTEX User (
  PRIMARY_ID id STRING,
  name STRING,
  kyc_status STRING,
  risk_score DOUBLE
)
CREATE VERTEX Account (
  PRIMARY_ID id STRING,
  user_id STRING,
  account_type STRING,
  created_date DATETIME,
  balance DOUBLE
)
CREATE VERTEX Transaction (
  PRIMARY_ID id STRING,
  amount DOUBLE,
  timestamp DATETIME,
  status STRING,
  risk_score DOUBLE
)
CREATE VERTEX Device (
  PRIMARY_ID id STRING,
  device_type STRING,
  os STRING
)
CREATE VERTEX IPAddress (
  PRIMARY_ID id STRING,
  country STRING,
  city STRING
)
CREATE DIRECTED EDGE OWNS_ACCOUNT (FROM User, TO Account)
CREATE DIRECTED EDGE MADE_TRANSACTION (FROM Account, TO Transaction)
CREATE DIRECTED EDGE RECEIVED_BY (FROM Transaction, TO Account)
CREATE DIRECTED EDGE USES_DEVICE (FROM User, TO Device)
CREATE DIRECTED EDGE CONNECTED_FROM (FROM User, TO IPAddress)
CREATE DIRECTED EDGE SHARES_DEVICE (FROM User, TO User)
CREATE GRAPH {g} (
  User,
  Account,
  Transaction,
  Device,
  IPAddress,
  OWNS_ACCOUNT,
  MADE_TRANSACTION,
  RECEIVED_BY,
  USES_DEVICE,
  CONNECTED_FROM,
  SHARES_DEVICE
)
"""
        schema_log = _gsql_plain_text(conn, ddl)

        queries = f"""
USE GRAPH {g}
CREATE QUERY fraudnet_cycle_detection() FOR GRAPH {g} SYNTAX v2 {{
  SetAccum<STRING> @@cycles;
  tmp = SELECT a FROM Account:a -(MADE_TRANSACTION>)- Transaction:t1 -(RECEIVED_BY>)- Account:b
              -(MADE_TRANSACTION>)- Transaction:t2 -(RECEIVED_BY>)- Account:c
              -(MADE_TRANSACTION>)- Transaction:t3 -(RECEIVED_BY>)- Account:a
        WHERE a.id < b.id AND b.id < c.id
        ACCUM @@cycles += a.id + "," + b.id + "," + c.id;
  PRINT @@cycles AS cycles;
}}

CREATE QUERY fraudnet_degree_centrality() FOR GRAPH {g} SYNTAX v2 {{
  MapAccum<STRING, INT> @@deg;
  all = SELECT a FROM Account:a
        ACCUM @@deg[a.id] += a.outdegree("MADE_TRANSACTION") + a.indegree("RECEIVED_BY");
  PRINT @@deg AS degrees;
}}

CREATE QUERY fraudnet_account_pairs() FOR GRAPH {g} SYNTAX v2 {{
  SetAccum<STRING> @@pairs;
  tmp = SELECT s FROM Account:s -(MADE_TRANSACTION>)- Transaction:m -(RECEIVED_BY>)- Account:t
        ACCUM @@pairs += s.id + "|" + t.id;
  PRINT @@pairs AS pairs;
}}
"""
        try:
            qlog = _gsql_plain_text(conn, queries)
        except Exception as qe:
            qlog = str(qe)

        install = f"""
USE GRAPH {g}
INSTALL QUERY fraudnet_cycle_detection
INSTALL QUERY fraudnet_degree_centrality
INSTALL QUERY fraudnet_account_pairs
"""
        try:
            ilog = _gsql_plain_text(conn, install)
        except Exception as ie:
            ilog = str(ie)

        return {
            "ok": True,
            "schema_gsql": schema_log[-2000:] if len(schema_log) > 2000 else schema_log,
            "queries_gsql": qlog[-2000:] if isinstance(qlog, str) and len(qlog) > 2000 else qlog,
            "install_gsql": ilog[-2000:] if isinstance(ilog, str) and len(ilog) > 2000 else ilog,
        }
    except Exception as e:
        msg = str(e)
        if "already exists" in msg or "AlreadyExists" in msg:
            print("[TigerGraph] Schema objects may already exist; continuing.")
            return {"ok": True, "note": "Some objects may already exist", "detail": msg}
        print(f"[TigerGraph] Schema error: {e}")
        return {"error": str(e)}


def load_transaction_data(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Upsert rows from a pandas DataFrame into FraudNet vertices and edges.

    Recognized columns (all optional except what you need for a given row batch):
    - User: user_id, user_name, kyc_status, user_risk_score
    - Account: account_id, user_id, account_type, created_date, balance
    - Transaction: transaction_id, amount, timestamp, status, risk_score
    - Device: device_id, device_type, os
    - IPAddress: ip_id, country, city
    - MADE_TRANSACTION: from_account, transaction_id
    - RECEIVED_BY: transaction_id, to_account
    - USES_DEVICE: device_user_id, device_id
    - CONNECTED_FROM: ip_user_id, ip_id
    - SHARES_DEVICE: shares_user_a, shares_user_b
    """
    print("[TigerGraph] Loading transaction dataframe into the graph (REST upsert)…")
    stats: Dict[str, Any] = {"vertices": {}, "edges": {}}
    try:
        conn = connect_to_tigergraph()

        if df is None or df.empty:
            return {"ok": True, "message": "Empty dataframe", **stats}

        dfc = df.copy()
        if "amount" not in dfc.columns and "Amount" in dfc.columns:
            dfc["amount"] = dfc["Amount"]

        def col(name: str) -> Optional[pd.Series]:
            return dfc[name] if name in dfc.columns else None

        verts: Dict[str, Dict[str, Dict[str, Any]]] = {}
        edge_groups: Dict[
            Tuple[str, str, str], List[Tuple[str, str, Dict[str, Any]]]
        ] = defaultdict(list)
        edge_counts: Dict[str, int] = defaultdict(int)

        def put_vertex(vtype: str, vid: str, attrs: Dict[str, Any]) -> None:
            verts.setdefault(vtype, {})
            verts[vtype][str(vid)] = dict(attrs)

        def put_edge(
            src_t: str,
            src_id: str,
            edge_t: str,
            tgt_t: str,
            tgt_id: str,
            attrs: Optional[Dict[str, Any]] = None,
        ) -> None:
            edge_groups[(src_t, edge_t, tgt_t)].append(
                (str(src_id), str(tgt_id), dict(attrs or {}))
            )
            edge_counts[edge_t] += 1

        if col("user_id") is not None:
            sub = dfc.dropna(subset=["user_id"]).drop_duplicates(subset=["user_id"])
            for _, r in sub.iterrows():
                put_vertex(
                    "User",
                    str(r["user_id"]),
                    {
                        "name": str(r.get("user_name", "")),
                        "kyc_status": str(r.get("kyc_status", "")),
                        "risk_score": float(r["user_risk_score"])
                        if pd.notna(r.get("user_risk_score"))
                        else 0.0,
                    },
                )

        if col("account_id") is not None:
            sub = dfc.dropna(subset=["account_id"]).drop_duplicates(subset=["account_id"])
            for _, r in sub.iterrows():
                cd = r.get("created_date")
                if pd.notna(cd) and not isinstance(cd, str):
                    cd = pd.Timestamp(cd).to_pydatetime()
                put_vertex(
                    "Account",
                    str(r["account_id"]),
                    {
                        "user_id": str(r.get("user_id", "")),
                        "account_type": str(r.get("account_type", "")),
                        "created_date": cd if pd.notna(cd) else "1970-01-01 00:00:00",
                        "balance": float(r["balance"])
                        if pd.notna(r.get("balance"))
                        else 0.0,
                    },
                )

        if col("transaction_id") is not None:
            sub = dfc.dropna(subset=["transaction_id"]).drop_duplicates(
                subset=["transaction_id"]
            )
            for _, r in sub.iterrows():
                ts = r.get("timestamp")
                if ts is None and "Time" in dfc.columns:
                    ts = r.get("Time")
                if pd.notna(ts) and not isinstance(ts, str):
                    ts = pd.Timestamp(ts).to_pydatetime()
                put_vertex(
                    "Transaction",
                    str(r["transaction_id"]),
                    {
                        "amount": float(r["amount"])
                        if pd.notna(r.get("amount"))
                        else 0.0,
                        "timestamp": ts if pd.notna(ts) else "1970-01-01 00:00:00",
                        "status": str(r.get("status", "")),
                        "risk_score": float(r["risk_score"])
                        if pd.notna(r.get("risk_score"))
                        else 0.0,
                    },
                )

        if col("device_id") is not None:
            sub = dfc.dropna(subset=["device_id"]).drop_duplicates(subset=["device_id"])
            for _, r in sub.iterrows():
                put_vertex(
                    "Device",
                    str(r["device_id"]),
                    {
                        "device_type": str(r.get("device_type", "")),
                        "os": str(r.get("os", "")),
                    },
                )

        if col("ip_id") is not None:
            sub = dfc.dropna(subset=["ip_id"]).drop_duplicates(subset=["ip_id"])
            for _, r in sub.iterrows():
                put_vertex(
                    "IPAddress",
                    str(r["ip_id"]),
                    {
                        "country": str(r.get("country", "")),
                        "city": str(r.get("city", "")),
                    },
                )

        if (
            col("user_id") is not None
            and col("account_id") is not None
            and not dfc[["user_id", "account_id"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["user_id", "account_id"]).iterrows():
                put_edge(
                    "User",
                    str(r["user_id"]),
                    "OWNS_ACCOUNT",
                    "Account",
                    str(r["account_id"]),
                )

        if (
            col("from_account") is not None
            and col("transaction_id") is not None
            and not dfc[["from_account", "transaction_id"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["from_account", "transaction_id"]).iterrows():
                put_edge(
                    "Account",
                    str(r["from_account"]),
                    "MADE_TRANSACTION",
                    "Transaction",
                    str(r["transaction_id"]),
                )

        if (
            col("transaction_id") is not None
            and col("to_account") is not None
            and not dfc[["transaction_id", "to_account"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["transaction_id", "to_account"]).iterrows():
                put_edge(
                    "Transaction",
                    str(r["transaction_id"]),
                    "RECEIVED_BY",
                    "Account",
                    str(r["to_account"]),
                )

        if (
            col("device_user_id") is not None
            and col("device_id") is not None
            and not dfc[["device_user_id", "device_id"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["device_user_id", "device_id"]).iterrows():
                put_edge(
                    "User",
                    str(r["device_user_id"]),
                    "USES_DEVICE",
                    "Device",
                    str(r["device_id"]),
                )

        if (
            col("ip_user_id") is not None
            and col("ip_id") is not None
            and not dfc[["ip_user_id", "ip_id"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["ip_user_id", "ip_id"]).iterrows():
                put_edge(
                    "User",
                    str(r["ip_user_id"]),
                    "CONNECTED_FROM",
                    "IPAddress",
                    str(r["ip_id"]),
                )

        if (
            col("shares_user_a") is not None
            and col("shares_user_b") is not None
            and not dfc[["shares_user_a", "shares_user_b"]].dropna().empty
        ):
            for _, r in dfc.dropna(subset=["shares_user_a", "shares_user_b"]).iterrows():
                put_edge(
                    "User",
                    str(r["shares_user_a"]),
                    "SHARES_DEVICE",
                    "User",
                    str(r["shares_user_b"]),
                )

        batch = 400
        acc_v, acc_e = 0, 0
        for vtype, bucket in verts.items():
            ids = list(bucket.items())
            for i in range(0, len(ids), batch):
                chunk = ids[i : i + batch]
                av = upsert_vertices_rest(conn, vtype, chunk)
                acc_v += av
                stats["vertices"][vtype] = stats["vertices"].get(vtype, 0) + av

        for (src_t, edge_t, tgt_t), elist in edge_groups.items():
            for i in range(0, len(elist), batch):
                chunk = elist[i : i + batch]
                ae = upsert_edges_rest(conn, src_t, edge_t, tgt_t, chunk)
                acc_e += ae

        stats["edges"] = dict(edge_counts)
        stats["accepted_vertices"] = acc_v
        stats["accepted_edges"] = acc_e
        stats["ok"] = True
        print(f"[TigerGraph] Load complete: {stats}")
        return stats
    except Exception as e:
        print(f"[TigerGraph] load_transaction_data failed: {e}")
        return {"error": str(e)}


def _union_find(pairs: List[Tuple[str, str]]) -> List[List[str]]:
    parent: Dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a, b in pairs:
        union(a, b)

    clusters: Dict[str, Set[str]] = defaultdict(set)
    for x in parent:
        clusters[find(x)].add(x)
    out = [sorted(s) for s in clusters.values()]
    out.sort(key=lambda c: (-len(c), c[0] if c else ""))
    return out


def _extract_query_field(raw: Any, field: str) -> Any:
    if raw is None:
        return None
    if isinstance(raw, list) and raw:
        block = raw[0]
        if isinstance(block, dict) and field in block:
            return block[field]
        for item in raw:
            if isinstance(item, dict) and field in item:
                return item[field]
    if isinstance(raw, dict):
        if field in raw:
            return raw[field]
        r = raw.get("results")
        if isinstance(r, list) and r:
            return _extract_query_field(r, field)
    return None


def run_cycle_detection() -> List[Any]:
    """
    Run installed GSQL query fraudnet_cycle_detection (3-account transaction cycles A→B→C→A).
    Returns a list of account-id triples as comma-separated strings (or parsed lists when possible).
    """
    print("[TigerGraph] Running cycle detection query…")
    try:
        conn = connect_to_tigergraph()
        g = quote(str(conn["graph"]), safe="")
        raw = tg_get(conn, f"/restpp/query/{g}/fraudnet_cycle_detection")
        out: List[Any] = []
        c = _extract_query_field(raw, "cycles")
        if isinstance(c, list):
            for item in c:
                if isinstance(item, str):
                    parts = [p.strip() for p in item.split(",") if p.strip()]
                    out.append(parts if len(parts) == 3 else item)
                else:
                    out.append(item)
        elif c is not None:
            out.append(c)
        print(f"[TigerGraph] Found {len(out)} cycle record(s).")
        return out
    except Exception as e:
        print(f"[TigerGraph] run_cycle_detection failed: {e}")
        return []


def run_connected_components() -> List[List[str]]:
    """
    Uses installed query fraudnet_account_pairs then union-find in Python
    to return weakly connected account clusters over the money-flow skeleton
    (Account → Transaction → Account).
    """
    print("[TigerGraph] Computing account connected components…")
    try:
        conn = connect_to_tigergraph()
        g = quote(str(conn["graph"]), safe="")
        raw = tg_get(conn, f"/restpp/query/{g}/fraudnet_account_pairs")
        pairs: List[Tuple[str, str]] = []
        pl = _extract_query_field(raw, "pairs")
        if isinstance(pl, (list, set)):
            for p in pl:
                if isinstance(p, str) and "|" in p:
                    a, b = p.split("|", 1)
                    pairs.append((a.strip(), b.strip()))
        clusters = _union_find(pairs)
        print(f"[TigerGraph] {len(clusters)} cluster(s) found.")
        return clusters
    except Exception as e:
        print(f"[TigerGraph] run_connected_components failed: {e}")
        return []


def run_degree_centrality() -> List[Dict[str, Any]]:
    """
    Ranks accounts by MADE_TRANSACTION outdegree plus RECEIVED_BY indegree.
    """
    print("[TigerGraph] Running degree centrality query…")
    try:
        conn = connect_to_tigergraph()
        g = quote(str(conn["graph"]), safe="")
        raw = tg_get(conn, f"/restpp/query/{g}/fraudnet_degree_centrality")
        ranked: List[Dict[str, Any]] = []
        deg_map = _extract_query_field(raw, "degrees")
        if isinstance(deg_map, dict):
            for aid, d in deg_map.items():
                try:
                    ranked.append({"account_id": aid, "degree": int(d)})
                except (TypeError, ValueError):
                    continue
        ranked.sort(key=lambda x: (-x["degree"], x["account_id"]))
        print(f"[TigerGraph] Ranked {len(ranked)} account(s) by degree.")
        return ranked
    except Exception as e:
        print(f"[TigerGraph] run_degree_centrality failed: {e}")
        return []


def _rest_fetch_vertex(conn: dict, g: str, vtype: str, vid: str) -> Dict[str, Any]:
    path = f"/restpp/graph/{quote(g, safe='')}/vertices/{quote(vtype, safe='')}/{quote(str(vid), safe='')}"
    data = tg_get(conn, path)
    rows = _tg_results_rows(data)
    if not rows:
        return {}
    return _vertex_record_to_attrs(rows[0])


def _rest_list_edges(conn: dict, g: str, vtype: str, vid: str) -> List[dict]:
    path = f"/restpp/graph/{quote(g, safe='')}/edges/{quote(vtype, safe='')}/{quote(str(vid), safe='')}"
    data = tg_get(conn, path)
    return _tg_results_rows(data)


def get_entity_neighborhood(entity_id: str, entity_type: str) -> Dict[str, Any]:
    """
    Return nodes and edges within 2 hops of the given vertex for visualization (REST++).
    """
    print(
        f"[TigerGraph] Fetching 2-hop neighborhood for {entity_type} `{entity_id}`…"
    )
    try:
        conn = connect_to_tigergraph()
        g = str(conn["graph"])

        if entity_type not in ALLOWED_VERTEX_TYPES:
            return {
                "nodes": [],
                "edges": [],
                "error": f"entity_type must be one of {sorted(ALLOWED_VERTEX_TYPES)}",
            }

        eid = _safe_entity_id(entity_id)
        nodes: Dict[Tuple[str, str], Dict[str, Any]] = {}
        edges_out: List[Dict[str, Any]] = []
        seen_e: Set[Tuple[str, str, str, str, str]] = set()

        def add_node(vtype: str, vid: str, attrs: Optional[dict]) -> None:
            key = (vtype, str(vid))
            if key not in nodes:
                nodes[key] = {
                    "id": str(vid),
                    "type": vtype,
                    "attributes": attrs or {},
                }

        root_attrs = _rest_fetch_vertex(conn, g, entity_type, eid)
        add_node(entity_type, eid, root_attrs)

        frontier: List[Tuple[str, str]] = [(entity_type, eid)]

        for _hop in range(2):
            next_frontier: List[Tuple[str, str]] = []
            for cur_t, cur_id in frontier:
                for er in _rest_list_edges(conn, g, cur_t, cur_id):
                    ft = str(er.get("from_type", ""))
                    fid = str(er.get("from_id", ""))
                    tt = str(er.get("to_type", ""))
                    tid = str(er.get("to_id", ""))
                    etn = str(er.get("e_type", ""))
                    if not tid or not etn:
                        continue
                    if fid == str(cur_id) and ft == cur_t:
                        nbr_t, nbr_id = tt, tid
                        src_t, src_id, tgt_t, tgt_id = ft, fid, tt, tid
                    elif tid == str(cur_id) and tt == cur_t:
                        nbr_t, nbr_id = ft, fid
                        src_t, src_id, tgt_t, tgt_id = ft, fid, tt, tid
                    else:
                        continue
                    ekey = (src_t, src_id, etn, tgt_t, tgt_id)
                    if ekey in seen_e:
                        continue
                    seen_e.add(ekey)
                    e_attr = er.get("attributes")
                    if not isinstance(e_attr, dict):
                        e_attr = {}
                    edges_out.append(
                        {
                            "from_type": src_t,
                            "from_id": src_id,
                            "edge": etn,
                            "to_type": tgt_t,
                            "to_id": tgt_id,
                            "attributes": e_attr,
                        }
                    )
                    if (nbr_t, nbr_id) not in nodes:
                        nat = _rest_fetch_vertex(conn, g, nbr_t, nbr_id)
                        add_node(nbr_t, nbr_id, nat)
                        next_frontier.append((nbr_t, nbr_id))
            frontier = next_frontier

        return {
            "nodes": list(nodes.values()),
            "edges": edges_out,
        }
    except ValueError as e:
        print(f"[TigerGraph] get_entity_neighborhood validation error: {e}")
        return {"nodes": [], "edges": [], "error": str(e)}
    except Exception as e:
        print(f"[TigerGraph] get_entity_neighborhood failed: {e}")
        return {"nodes": [], "edges": [], "error": str(e)}
