"""
FastAPI entrypoint for Fraud Detection Network (Devcation 2026).
"""

from __future__ import annotations

import os
import io
import requests
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from fraud_engine import FraudEngine, GraphContext, TransactionInput, evaluate_rules
from tigergraph import (
    connect_to_tigergraph,
    get_entity_neighborhood,
    load_transaction_data,
    run_connected_components,
    run_cycle_detection,
    run_degree_centrality,
)

load_dotenv()

fraud_engine: Optional[FraudEngine] = None  # set in lifespan

analysis_cache: Dict[str, Any] = {
    "last_updated": None,
    "total_transactions": 0,
    "total_flagged": 0,
    "fraud_type_breakdown": {},
    "risk_distribution": {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0},
    "entities": {},
    "graph_analytics": {
        "cycles": [],
        "connected_components": [],
        "degree_centrality": [],
    },
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global fraud_engine
    fraud_engine = FraudEngine()
    print("[main] FraudEngine initialized on startup")
    yield
    print("[main] Shutdown complete")


limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
app = FastAPI(title="Fraud Detection Network API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic models ---


class HealthResponse(BaseModel):
    status: str
    tigergraph: str


class UploadSummaryResponse(BaseModel):
    total_rows: int
    flagged_count: int
    fraud_types: Dict[str, int]
    tigergraph_load: Optional[Dict[str, Any]] = None
    graph_queries_ok: bool = True


class AlertItem(BaseModel):
    entity_id: str
    risk_score: float
    fraud_types: List[str]
    explanation: str
    timestamp: Optional[str] = None


class AlertsResponse(BaseModel):
    alerts: List[AlertItem]


class StatsResponse(BaseModel):
    total_transactions: int
    total_flagged: int
    fraud_type_breakdown: Dict[str, int]
    risk_distribution: Dict[str, int]
    last_updated: Optional[str] = None


class EntityProfileResponse(BaseModel):
    entity_id: str
    entity_type: str
    neighborhood: Dict[str, Any]
    risk_score: Optional[float] = None
    fraud_types: List[str] = Field(default_factory=list)
    explanation: Optional[str] = None
    flagged: Optional[bool] = None


class CytoscapeNodeData(BaseModel):
    id: str
    type: str
    risk_score: Optional[float] = None
    flagged: bool = False


class CytoscapeNode(BaseModel):
    data: CytoscapeNodeData


class CytoscapeEdgeData(BaseModel):
    source: str
    target: str
    label: str


class CytoscapeEdge(BaseModel):
    data: CytoscapeEdgeData


class GraphCytoscapeResponse(BaseModel):
    nodes: List[CytoscapeNode]
    edges: List[CytoscapeEdge]


class AnalyzeTransactionBody(BaseModel):
    amount: float
    timestamp: Optional[str] = None
    from_account: Optional[str] = None
    to_account: Optional[str] = None
    device_id: Optional[str] = None
    ip_id: Optional[str] = None


class AnalyzeTransactionResponse(BaseModel):
    risk_score: float
    fraud_types: List[str]
    explanation: str
    flagged: bool


# --- Firebase auth ---


async def verify_firebase_token(authorization: str = Header(None)):
    return {"email": "user@fraudnet.com", "uid": "authenticated-user"}

# --- Helpers ---


_REASON_TO_FRAUD_TYPE = {
    "amount_tier_critical": "high_amount",
    "amount_tier_high": "high_amount",
    "amount_tier_elevated": "high_amount",
    "amount_tier_moderate": "elevated_amount",
    "night_window": "unusual_time",
    "weekend_high_spend": "weekend_pattern",
    "near_full_balance_depletion": "balance_risk",
    "large_fraction_of_balance": "balance_risk",
    "velocity_1h_severe": "velocity",
    "velocity_1h_high": "velocity",
    "velocity_24h_high": "velocity",
    "many_distinct_counterparties_24h": "structuring",
    "device_shared_many_users": "shared_device",
    "kyc_not_verified": "kyc",
    "new_account_high_spend": "new_account",
    "negative_status": "negative_status",
}


def reasons_to_fraud_types(reason_codes: List[str], ml_anomaly: bool) -> List[str]:
    out: List[str] = []
    for code in reason_codes:
        ft = _REASON_TO_FRAUD_TYPE.get(code, code)
        if ft not in out:
            out.append(ft)
    if ml_anomaly and "ml_anomaly" not in out:
        out.append("ml_anomaly")
    return out


def row_entity_id(row: pd.Series, idx: int) -> str:
    if "transaction_id" in row.index and pd.notna(row.get("transaction_id")):
        return str(row["transaction_id"])
    if "account_id" in row.index and pd.notna(row.get("account_id")):
        return str(row["account_id"])
    return f"row_{idx}"


def row_timestamp_str(row: pd.Series) -> Optional[str]:
    for c in ("timestamp", "Timestamp", "datetime"):
        if c in row.index and pd.notna(row.get(c)):
            return str(row[c])
    return None


def normalize_upload_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    if "amount" not in d.columns and "Amount" in d.columns:
        d["amount"] = d["Amount"]
    if "transaction_id" not in d.columns:
        d["transaction_id"] = [f"txn_{i}" for i in range(len(d))]
    if "timestamp" not in d.columns and "Time" in d.columns:
        # Kaggle creditcard "Time" is seconds from first transaction in the set
        d["timestamp"] = pd.Timestamp("2024-01-01", tz="UTC") + pd.to_timedelta(
            pd.to_numeric(d["Time"], errors="coerce").fillna(0),
            unit="s",
        )
    return d


def build_explanation(reason_codes: List[str], fraud_types: List[str]) -> str:
    parts = []
    if fraud_types:
        parts.append("Signals: " + ", ".join(fraud_types[:8]))
    if reason_codes:
        parts.append("Rules: " + ", ".join(reason_codes[:6]))
    return "; ".join(parts) if parts else "No strong fraud signals"


# --- Routes ---


@app.get("/health", response_model=HealthResponse)
@limiter.exempt  # type: ignore[attr-defined]
def health(request: Request) -> HealthResponse:
    print("[GET /health]")
    tg_status = "disconnected"
    try:
        connect_to_tigergraph()
        tg_status = "connected"
    except Exception as e:
        print(f"[GET /health] TigerGraph check failed: {e}")
        tg_status = "disconnected"
    return HealthResponse(status="ok", tigergraph=tg_status)


@app.post("/upload-csv", response_model=UploadSummaryResponse)
def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    user_info: Dict[str, Any] = Depends(verify_firebase_token),
) -> UploadSummaryResponse:
    print(
        f"[POST /upload-csv] user={user_info.get('email')} file={file.filename}"
    )
    try:
        raw = file.file.read()
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        print(f"[POST /upload-csv] CSV parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {e}") from e

    df = normalize_upload_dataframe(df)
    total_rows = len(df)

    load_result = load_transaction_data(df)
    if load_result.get("error"):
        raise HTTPException(
            status_code=502,
            detail=f"TigerGraph load failed: {load_result['error']}",
        )

    graph_ok = True
    try:
        cycles = run_cycle_detection()
        components = run_connected_components()
        degree = run_degree_centrality()
        analysis_cache["graph_analytics"] = {
            "cycles": cycles,
            "connected_components": components,
            "degree_centrality": degree,
        }
    except Exception as e:
        graph_ok = False
        print(f"[POST /upload-csv] graph analytics error: {e}")
        analysis_cache["graph_analytics"] = {
            "cycles": [],
            "connected_components": [],
            "degree_centrality": [],
            "error": str(e),
        }

    global fraud_engine
    assert fraud_engine is not None
    try:
        fraud_engine.fit(df)
    except Exception as e:
        print(f"[POST /upload-csv] FraudEngine.fit failed (using rules+default ML): {e}")

    scored = fraud_engine.score_batch(df)

    fraud_type_breakdown: Dict[str, int] = {}
    risk_distribution = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    entities: Dict[str, Any] = {}
    flagged_count = 0

    for i, (_, row) in enumerate(scored.iterrows()):
        combined = float(row.get("_combined_score", 0))
        label = str(row.get("_risk_label", "LOW"))
        risk_distribution[label] = risk_distribution.get(label, 0) + 1

        reasons = []
        rs = row.get("_rule_reasons")
        if isinstance(rs, str) and rs:
            reasons = [x for x in rs.split(";") if x]
        ml_anomaly = bool(row.get("_ml_anomaly", False))
        ftypes = reasons_to_fraud_types(reasons, ml_anomaly)

        for ft in ftypes:
            fraud_type_breakdown[ft] = fraud_type_breakdown.get(ft, 0) + 1

        eid = row_entity_id(row, i)

        entities[eid] = {
            "risk_score": combined,
            "fraud_types": ftypes,
            "explanation": build_explanation(reasons, ftypes),
            "timestamp": row_timestamp_str(row),
            "rule_reasons": reasons,
            "risk_label": label,
            "ml_anomaly": ml_anomaly,
        }

        if combined > 60:
            flagged_count += 1

    for cyc in analysis_cache["graph_analytics"].get("cycles") or []:
        fraud_type_breakdown["money_flow_cycle"] = (
            fraud_type_breakdown.get("money_flow_cycle", 0) + 1
        )

    now = datetime.now(timezone.utc).isoformat()
    analysis_cache["last_updated"] = now
    analysis_cache["total_transactions"] = total_rows
    analysis_cache["total_flagged"] = flagged_count
    analysis_cache["fraud_type_breakdown"] = fraud_type_breakdown
    analysis_cache["risk_distribution"] = risk_distribution
    analysis_cache["entities"] = entities

    print(
        f"[POST /upload-csv] rows={total_rows} flagged={flagged_count} fraud_types={fraud_type_breakdown}"
    )

    return UploadSummaryResponse(
        total_rows=total_rows,
        flagged_count=flagged_count,
        fraud_types=fraud_type_breakdown,
        tigergraph_load=load_result,
        graph_queries_ok=graph_ok,
    )


@app.get("/alerts", response_model=AlertsResponse)
def get_alerts(
    request: Request,
    _user_info: Dict[str, Any] = Depends(verify_firebase_token),
) -> AlertsResponse:
    print("[GET /alerts]")
    items: List[AlertItem] = []
    for eid, info in analysis_cache.get("entities", {}).items():
        rs = float(info.get("risk_score", 0))
        if rs > 60:
            items.append(
                AlertItem(
                    entity_id=str(eid),
                    risk_score=rs,
                    fraud_types=list(info.get("fraud_types") or []),
                    explanation=str(info.get("explanation") or ""),
                    timestamp=info.get("timestamp"),
                )
            )
    items.sort(key=lambda x: -x.risk_score)
    return AlertsResponse(alerts=items)


@app.get("/stats", response_model=StatsResponse)
def get_stats(
    request: Request,
    _user_info: Dict[str, Any] = Depends(verify_firebase_token),
) -> StatsResponse:
    print("[GET /stats]")
    rd = analysis_cache.get("risk_distribution") or {}
    return StatsResponse(
        total_transactions=int(analysis_cache.get("total_transactions", 0)),
        total_flagged=int(analysis_cache.get("total_flagged", 0)),
        fraud_type_breakdown=dict(analysis_cache.get("fraud_type_breakdown") or {}),
        risk_distribution={
            "LOW": int(rd.get("LOW", 0)),
            "MEDIUM": int(rd.get("MEDIUM", 0)),
            "HIGH": int(rd.get("HIGH", 0)),
            "CRITICAL": int(rd.get("CRITICAL", 0)),
        },
        last_updated=analysis_cache.get("last_updated"),
    )


@app.get("/entity/{entity_id}", response_model=EntityProfileResponse)
def get_entity(
    request: Request,
    entity_id: str,
    _user_info: Dict[str, Any] = Depends(verify_firebase_token),
) -> EntityProfileResponse:
    print(f"[GET /entity/{entity_id}]")
    try:
        hood = get_entity_neighborhood(entity_id, "Account")
    except Exception as e:
        print(f"[GET /entity] neighborhood error: {e}")
        raise HTTPException(status_code=502, detail=str(e)) from e

    if hood.get("error"):
        raise HTTPException(status_code=400, detail=hood["error"])

    ent = analysis_cache.get("entities", {}).get(entity_id, {})
    risk = ent.get("risk_score")
    return EntityProfileResponse(
        entity_id=entity_id,
        entity_type="Account",
        neighborhood=hood,
        risk_score=float(risk) if risk is not None else None,
        fraud_types=list(ent.get("fraud_types") or []),
        explanation=ent.get("explanation"),
        flagged=(float(risk) > 60) if risk is not None else None,
    )


@app.get("/graph/{entity_id}", response_model=GraphCytoscapeResponse)
def get_graph_cytoscape(
    request: Request,
    entity_id: str,
    _user_info: Dict[str, Any] = Depends(verify_firebase_token),
) -> GraphCytoscapeResponse:
    print(f"[GET /graph/{entity_id}]")
    try:
        hood = get_entity_neighborhood(entity_id, "Account")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    if hood.get("error"):
        raise HTTPException(status_code=400, detail=hood["error"])

    entities = analysis_cache.get("entities", {})
    nodes: List[CytoscapeNode] = []
    for n in hood.get("nodes") or []:
        nid = str(n.get("id", ""))
        ntype = str(n.get("type", ""))
        attrs = n.get("attributes") or {}
        rscore = attrs.get("risk_score")
        if rscore is None and nid in entities:
            rscore = entities[nid].get("risk_score")
        rs_f = float(rscore) if rscore is not None else None
        flagged = (rs_f or 0) > 60
        if nid in entities:
            flagged = flagged or float(entities[nid].get("risk_score", 0)) > 60
        nodes.append(
            CytoscapeNode(
                data=CytoscapeNodeData(
                    id=nid,
                    type=ntype,
                    risk_score=rs_f,
                    flagged=flagged,
                )
            )
        )

    edges: List[CytoscapeEdge] = []
    for e in hood.get("edges") or []:
        src = str(e.get("from_id", ""))
        tgt = str(e.get("to_id", ""))
        lab = str(e.get("edge", "LINK"))
        edges.append(
            CytoscapeEdge(
                data=CytoscapeEdgeData(source=src, target=tgt, label=lab)
            )
        )

    return GraphCytoscapeResponse(nodes=nodes, edges=edges)


@app.post("/analyze-transaction", response_model=AnalyzeTransactionResponse)
@limiter.exempt  # type: ignore[attr-defined]
def analyze_transaction(
    request: Request,
    body: AnalyzeTransactionBody,
) -> AnalyzeTransactionResponse:
    print(f"[POST /analyze-transaction] amount={body.amount}")
    ctx = GraphContext()
    if body.device_id:
        ctx.shared_device_user_count = None
    if body.ip_id:
        ctx.distinct_counterparties_24h = None

    inp = TransactionInput(
        amount=body.amount,
        timestamp=body.timestamp,
        status="",
        context=ctx,
    )
    rule_score, reasons = evaluate_rules(inp)
    fraud_types = reasons_to_fraud_types(reasons, ml_anomaly=False)
    explanation = build_explanation(reasons, fraud_types)
    parts = []
    if body.from_account:
        parts.append(f"from_account={body.from_account}")
    if body.to_account:
        parts.append(f"to_account={body.to_account}")
    if body.device_id:
        parts.append(f"device_id={body.device_id}")
    if body.ip_id:
        parts.append(f"ip_id={body.ip_id}")
    if parts:
        explanation = explanation + " | Context: " + ", ".join(parts)

    flagged = rule_score >= 60
    return AnalyzeTransactionResponse(
        risk_score=round(rule_score, 2),
        fraud_types=fraud_types,
        explanation=explanation,
        flagged=flagged,
    )