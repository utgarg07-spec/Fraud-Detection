"""
Rule-based + Isolation Forest scoring for FraudNet transactions.

Designed for:
- Live scoring from amount/timestamp + optional graph context (velocity, device/IP signals).
- Offline training on the Kaggle creditcard dataset (Time, V1–V28, Amount, Class) or any
  DataFrame with at least `amount` and optional time/V-columns.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

_VCOL_RE = re.compile(r"^V\d+$", re.I)


@dataclass
class GraphContext:
    """Optional signals from TigerGraph / app layer for rule scoring."""

    account_balance: Optional[float] = None
    recent_txn_count_1h: Optional[int] = None
    recent_txn_count_24h: Optional[int] = None
    distinct_counterparties_24h: Optional[int] = None
    shared_device_user_count: Optional[int] = None
    user_kyc_verified: Optional[bool] = None
    account_age_hours: Optional[float] = None


@dataclass
class TransactionInput:
    """One transaction for scoring."""

    amount: float
    timestamp: Optional[Any] = None  # datetime-like or pandas-parsable string
    status: str = ""
    extra_features: Dict[str, float] = field(default_factory=dict)
    context: Optional[GraphContext] = None


@dataclass
class FraudScore:
    rule_score: float
    ml_score: float
    combined_score: float
    risk_label: str
    rule_reasons: List[str]
    ml_anomaly: bool
    ml_raw_score: Optional[float] = None


def _parse_ts(ts: Any) -> Optional[pd.Timestamp]:
    if ts is None or (isinstance(ts, float) and math.isnan(ts)):
        return None
    try:
        return pd.Timestamp(ts)
    except Exception:
        return None


def _hour_dow(ts: Optional[pd.Timestamp]) -> Tuple[float, float]:
    if ts is None or pd.isna(ts):
        return 12.0, 3.0
    return float(ts.hour), float(ts.dayofweek)


def _log1p_safe(x: float) -> float:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return 0.0
    return float(np.log1p(max(x, 0.0)))


def evaluate_rules(inp: TransactionInput) -> Tuple[float, List[str]]:
    """
    Deterministic rules → score in [0, 100] and human-readable triggers.
    """
    reasons: List[str] = []
    score = 0.0
    amount = float(inp.amount) if inp.amount is not None else 0.0
    ts = _parse_ts(inp.timestamp)
    hour, dow = _hour_dow(ts)

    if amount >= 50_000:
        score += 35
        reasons.append("amount_tier_critical")
    elif amount >= 10_000:
        score += 25
        reasons.append("amount_tier_high")
    elif amount >= 5_000:
        score += 15
        reasons.append("amount_tier_elevated")
    elif amount >= 2_000:
        score += 8
        reasons.append("amount_tier_moderate")

    if 1 <= hour <= 5:
        score += 12
        reasons.append("night_window")

    if dow >= 5 and amount >= 800:
        score += 6
        reasons.append("weekend_high_spend")

    ctx = inp.context
    if ctx:
        if ctx.account_balance is not None and ctx.account_balance > 0:
            ratio = amount / ctx.account_balance
            if ratio >= 0.95:
                score += 28
                reasons.append("near_full_balance_depletion")
            elif ratio >= 0.5:
                score += 12
                reasons.append("large_fraction_of_balance")

        if ctx.recent_txn_count_1h is not None:
            if ctx.recent_txn_count_1h >= 8:
                score += 22
                reasons.append("velocity_1h_severe")
            elif ctx.recent_txn_count_1h >= 4:
                score += 12
                reasons.append("velocity_1h_high")

        if ctx.recent_txn_count_24h is not None and ctx.recent_txn_count_24h >= 25:
            score += 10
            reasons.append("velocity_24h_high")

        if ctx.distinct_counterparties_24h is not None and ctx.distinct_counterparties_24h >= 12:
            score += 10
            reasons.append("many_distinct_counterparties_24h")

        if ctx.shared_device_user_count is not None and ctx.shared_device_user_count >= 4:
            score += 14
            reasons.append("device_shared_many_users")

        if ctx.user_kyc_verified is False:
            score += 12
            reasons.append("kyc_not_verified")

        if ctx.account_age_hours is not None and ctx.account_age_hours < 48 and amount >= 500:
            score += 10
            reasons.append("new_account_high_spend")

    st = (inp.status or "").lower()
    if st in ("blocked", "reversed", "chargeback", "disputed"):
        score += 15
        reasons.append("negative_status")

    return min(100.0, score), reasons


def _risk_label(combined: float) -> str:
    if combined >= 85:
        return "CRITICAL"
    if combined >= 65:
        return "HIGH"
    if combined >= 40:
        return "MEDIUM"
    return "LOW"


class FraudEngine:
    """
    Trains IsolationForest on tabular history, then scores new rows.
    Feature layout after fit:
    - Always: log1p(amount), hour, day_of_week
    - Plus: any columns matching V1..V28 (case-insensitive) present at fit time
    - Plus: normalized `Time` column if present (Kaggle dataset)
    """

    def __init__(
        self,
        *,
        contamination: float = 0.02,
        random_state: int = 42,
        n_estimators: int = 200,
        rule_weight: float = 0.45,
        ml_weight: float = 0.55,
    ) -> None:
        if contamination <= 0 or contamination >= 0.5:
            raise ValueError("contamination should be in (0, 0.5)")
        self.contamination = contamination
        self.random_state = random_state
        self.n_estimators = n_estimators
        self.rule_weight = rule_weight
        self.ml_weight = ml_weight

        self._model: Optional[IsolationForest] = None
        self._scaler = StandardScaler()
        self._feature_columns: List[str] = []
        self._train_score_q05: float = 0.0
        self._train_score_q50: float = 0.0
        self._train_score_min: float = 0.0

    @property
    def is_fitted(self) -> bool:
        return self._model is not None

    def _resolve_feature_names(self, df: pd.DataFrame) -> List[str]:
        cols = ["_log_amount", "_hour", "_dow"]
        vcols = sorted(
            [c for c in df.columns if _VCOL_RE.match(str(c))],
            key=lambda x: int(str(x)[1:]),
        )
        cols.extend(vcols)
        if "Time" in df.columns:
            cols.append("_time_norm")
        return cols

    def _build_matrix(self, df: pd.DataFrame, fit: bool) -> np.ndarray:
        out_cols: List[np.ndarray] = []
        names: List[str] = []

        amounts = pd.to_numeric(df.get("amount", df.get("Amount", 0)), errors="coerce").fillna(0.0)
        out_cols.append(np.vectorize(_log1p_safe)(amounts.to_numpy()))
        names.append("_log_amount")

        ts_col = None
        for c in ("timestamp", "Timestamp", "datetime", "time_parsed"):
            if c in df.columns:
                ts_col = c
                break
        if ts_col:
            parsed = pd.to_datetime(df[ts_col], errors="coerce")
            hours = parsed.dt.hour.fillna(12).astype(float).to_numpy()
            dows = parsed.dt.dayofweek.fillna(3).astype(float).to_numpy()
        else:
            hours = np.full(len(df), 12.0)
            dows = np.full(len(df), 3.0)
        out_cols.append(hours)
        names.append("_hour")
        out_cols.append(dows)
        names.append("_dow")

        vcols = sorted(
            [c for c in df.columns if _VCOL_RE.match(str(c))],
            key=lambda x: int(str(x)[1:]),
        )
        for vc in vcols:
            out_cols.append(pd.to_numeric(df[vc], errors="coerce").fillna(0.0).to_numpy())
            names.append(vc)

        if "Time" in df.columns:
            t = pd.to_numeric(df["Time"], errors="coerce").fillna(0.0).to_numpy()
            t_std = (t - np.mean(t)) / (np.std(t) + 1e-9)
            out_cols.append(t_std)
            names.append("_time_norm")

        X = np.column_stack(out_cols)
        if fit:
            self._feature_columns = names
        else:
            # align with training columns
            if not self._feature_columns:
                raise RuntimeError("FraudEngine.fit must be called before scoring with ML.")
            idx_map = {n: i for i, n in enumerate(names)}
            aligned = []
            for name in self._feature_columns:
                if name in idx_map:
                    aligned.append(X[:, idx_map[name]])
                else:
                    aligned.append(np.zeros(len(df)))
            X = np.column_stack(aligned)
        return X

    def fit(self, df: pd.DataFrame) -> "FraudEngine":
        if df is None or df.empty:
            raise ValueError("fit() requires a non-empty DataFrame")
        dfc = df.copy()
        if "amount" not in dfc.columns and "Amount" in dfc.columns:
            dfc["amount"] = dfc["Amount"]

        X = self._build_matrix(dfc, fit=True)
        Xs = self._scaler.fit_transform(X)

        self._model = IsolationForest(
            n_estimators=self.n_estimators,
            contamination=self.contamination,
            random_state=self.random_state,
            n_jobs=-1,
        )
        self._model.fit(Xs)
        train_scores = self._model.score_samples(Xs)
        self._train_score_min = float(np.min(train_scores))
        self._train_score_q05 = float(np.percentile(train_scores, 5))
        self._train_score_q50 = float(np.percentile(train_scores, 50))
        return self

    def _ml_risk_from_score(self, s: float) -> Tuple[float, bool]:
        """
        Map IsolationForest score_samples (lower = more anomalous) to [0, 100].
        """
        if self._model is None:
            return 50.0, False

        # Strong anomaly: below 5th percentile of training
        if s <= self._train_score_q05:
            denom = max(1e-9, self._train_score_q05 - self._train_score_min)
            severity = min(1.0, (self._train_score_q05 - s) / denom)
            risk = 72.0 + 28.0 * severity
            return min(100.0, risk), True

        if s <= self._train_score_q50:
            span = max(1e-9, self._train_score_q50 - self._train_score_q05)
            t = (self._train_score_q50 - s) / span
            risk = 38.0 + 34.0 * t
            return min(100.0, risk), t > 0.85

        risk = max(5.0, 35.0 - 25.0 * min(1.0, (s - self._train_score_q50) / (abs(self._train_score_q50) + 1e-9)))
        return risk, False

    def score_samples_ml(self, df: pd.DataFrame) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError("Call fit() before score_samples_ml")
        assert self._model is not None
        X = self._build_matrix(df, fit=False)
        Xs = self._scaler.transform(X)
        return self._model.score_samples(Xs)

    def score_one(self, inp: TransactionInput) -> FraudScore:
        rule_score, reasons = evaluate_rules(inp)

        ml_score = 50.0
        ml_raw: Optional[float] = None
        ml_anomaly = False

        if self.is_fitted and self._model is not None:
            row: Dict[str, Any] = {"amount": inp.amount, "timestamp": inp.timestamp}
            if "Time" in inp.extra_features:
                row["Time"] = inp.extra_features["Time"]
            for k, v in inp.extra_features.items():
                if _VCOL_RE.match(k):
                    row[k] = v
            df1 = pd.DataFrame([row])
            ml_raw = float(self.score_samples_ml(df1)[0])
            ml_score, ml_anomaly = self._ml_risk_from_score(ml_raw)

        combined = self.rule_weight * rule_score + self.ml_weight * ml_score
        return FraudScore(
            rule_score=round(rule_score, 2),
            ml_score=round(ml_score, 2),
            combined_score=round(combined, 2),
            risk_label=_risk_label(combined),
            rule_reasons=reasons,
            ml_anomaly=ml_anomaly,
            ml_raw_score=round(ml_raw, 6) if ml_raw is not None else None,
        )

    def score_batch(
        self,
        df: pd.DataFrame,
        *,
        timestamp_col: str = "timestamp",
        context: Optional[GraphContext] = None,
    ) -> pd.DataFrame:
        """Alias for `score_dataframe` (batch CSV / API uploads)."""
        return self.score_dataframe(df, timestamp_col=timestamp_col, context=context)

    def score_dataframe(
        self,
        df: pd.DataFrame,
        *,
        timestamp_col: str = "timestamp",
        context: Optional[GraphContext] = None,
    ) -> pd.DataFrame:
        """
        Vectorized ML scores + per-row rules (same context applied to each row unless
        you pre-merge context columns and build TransactionInput in a loop yourself).
        """
        if df is None or df.empty:
            return df
        dfc = df.copy()
        if "amount" not in dfc.columns and "Amount" in dfc.columns:
            dfc["amount"] = dfc["Amount"]

        if self.is_fitted:
            raw = self.score_samples_ml(dfc)
            ml_risks = []
            flags = []
            for s in raw:
                r, f = self._ml_risk_from_score(float(s))
                ml_risks.append(r)
                flags.append(f)
            dfc["_ml_score"] = ml_risks
            dfc["_ml_anomaly"] = flags
            dfc["_ml_raw"] = raw
        else:
            dfc["_ml_score"] = 50.0
            dfc["_ml_anomaly"] = False
            dfc["_ml_raw"] = np.nan

        rule_scores = []
        rule_reasons: List[str] = []
        combined = []
        labels = []
        for _, r in dfc.iterrows():
            ts = r.get(timestamp_col, r.get("Timestamp"))
            st = str(r.get("status", r.get("Status", "")))
            tin = TransactionInput(
                amount=float(r.get("amount", r.get("Amount", 0)) or 0),
                timestamp=ts,
                status=st,
                context=context,
            )
            rs, rr = evaluate_rules(tin)
            rule_scores.append(rs)
            rule_reasons.append(";".join(rr))
            comb = self.rule_weight * rs + self.ml_weight * float(dfc.loc[r.name, "_ml_score"])
            combined.append(comb)
            labels.append(_risk_label(comb))

        dfc["_rule_score"] = rule_scores
        dfc["_rule_reasons"] = rule_reasons
        dfc["_combined_score"] = combined
        dfc["_risk_label"] = labels
        return dfc


def fraud_score_to_dict(fs: FraudScore) -> Dict[str, Any]:
    return {
        "rule_score": fs.rule_score,
        "ml_score": fs.ml_score,
        "combined_score": fs.combined_score,
        "risk_label": fs.risk_label,
        "rule_reasons": fs.rule_reasons,
        "ml_anomaly": fs.ml_anomaly,
        "ml_raw_score": fs.ml_raw_score,
    }


def quick_train_from_kaggle_csv(path: str) -> FraudEngine:
    """Convenience: load creditcard.csv and fit the engine."""
    df = pd.read_csv(path)
    eng = FraudEngine()
    eng.fit(df)
    return eng
