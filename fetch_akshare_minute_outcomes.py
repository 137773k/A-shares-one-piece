"""Backfill validation-only A-share T+1 5-minute bars through AKShare.

Pilot mode writes an isolated report. Full mode writes a separate minute cache;
neither mode mutates ranking inputs or grants execution authority.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parent
REPORT_PATH = ROOT / "data" / "reports" / "factor-effectiveness-validation-latest.json"
HISTORY_DIR = ROOT / "data" / "history"
DAILY_OUTCOME_PATH = ROOT / "data" / "factor-validation-outcomes.json"
PILOT_OUTPUT_PATH = ROOT / "data" / "reports" / "akshare-minute-pilot.json"
FULL_OUTPUT_PATH = ROOT / "data" / "factor-validation-minute-outcomes.json"
PRICE_TOLERANCE_PCT = 0.6
AMOUNT_TOLERANCE_PCT = 12.0
MIN_EXPECTED_BARS = 45
MAX_EXPECTED_BARS = 50
EASTMONEY_FAILURES = 0
EASTMONEY_DISABLED = False
AKSHARE_MODULE: Any = None


def load_akshare() -> Any:
    """Import the network provider only when a real fetch is requested.

    Offline normalization tests and ``--audit-existing`` do not need AKShare.
    """
    global AKSHARE_MODULE
    if AKSHARE_MODULE is not None:
        return AKSHARE_MODULE
    try:
        import akshare  # pylint: disable=import-outside-toplevel
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "AKShare is required for minute fetching; install requirements-akshare.txt "
            "or set A_SHARE_PYTHON to a prepared Python interpreter"
        ) from error
    AKSHARE_MODULE = akshare
    return AKSHARE_MODULE


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {} if default is None else default


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def normalize_date(value: Any) -> str | None:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) < 8:
        return None
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"


def finite(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def first_positive(*values: Any) -> float | None:
    for value in values:
        number = finite(value)
        if number is not None and number > 0:
            return number
    return None


def code_of(value: dict[str, Any]) -> str:
    return str(value.get("code") or value.get("secCode") or "").strip()[-6:]


def sina_symbol(code: str) -> str:
    prefix = "sh" if code.startswith(("5", "6", "9")) else "bj" if code.startswith(("4", "8")) else "sz"
    return prefix + code


def load_requirements() -> list[dict[str, Any]]:
    report = read_json(REPORT_PATH, {})
    requirements: dict[tuple[str, str], dict[str, Any]] = {}
    for day in report.get("rankingStudy", {}).get("days", []):
        next_date = normalize_date(day.get("nextDate"))
        if not next_date:
            continue
        outcomes = {str(row.get("code") or ""): row for row in day.get("outcomes", [])}
        for row in day.get("unifiedOrder", []):
            code = code_of(row)
            if code:
                outcome = outcomes.get(code, {})
                requirements[(code, next_date)] = {
                    "code": code,
                    "name": str(row.get("name") or code),
                    "signalDate": normalize_date(day.get("tradingDate")) or "",
                    "nextDate": next_date,
                    "priceBridgeValid": bool(
                        outcome.get("valid") is True
                        and finite(outcome.get("priceDifferencePct")) is not None
                        and float(outcome.get("priceDifferencePct")) <= 1.0
                    ),
                    "priceDifferencePct": finite(outcome.get("priceDifferencePct")),
                }
    return sorted(requirements.values(), key=lambda row: (row["nextDate"], row["code"]))


def select_pilot(requirements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in requirements:
        by_code[row["code"]].append(row)
    selected_codes = sorted(by_code, key=lambda code: (-len(by_code[code]), code))[:3]
    return [row for code in selected_codes for row in by_code[code][:3]]


def provider_date(snapshot: dict[str, Any]) -> str | None:
    return normalize_date(
        snapshot.get("market", {}).get("limitStats", {}).get("dates", {}).get("today")
        or snapshot.get("archiveMeta", {}).get("tradingDate")
        or snapshot.get("tradingDate")
    )


def load_raw_daily_references() -> dict[tuple[str, str], dict[str, Any]]:
    references: dict[tuple[str, str], dict[str, Any]] = {}
    for path in sorted(HISTORY_DIR.glob("20*.json")):
        snapshot = read_json(path, {})
        date = provider_date(snapshot)
        if not date:
            continue
        for stock in snapshot.get("candidates", []):
            code = code_of(stock)
            if not code:
                continue
            profile = stock.get("klineProfile") if isinstance(stock.get("klineProfile"), dict) else {}
            references[(code, date)] = {
                "source": "raw_closing_candidate_snapshot",
                "sourceFile": path.name,
                "date": date,
                "code": code,
                "open": first_positive(stock.get("open"), profile.get("lastSession", {}).get("open")),
                "high": first_positive(stock.get("high"), profile.get("lastSession", {}).get("high")),
                "low": first_positive(stock.get("low"), profile.get("lastSession", {}).get("low")),
                "close": first_positive(stock.get("price"), stock.get("close"), profile.get("lastClose")),
                "amount": (finite(stock.get("amountYi")) or 0) * 100_000_000 or None,
            }
    return references


def load_qfq_daily_references() -> dict[tuple[str, str], dict[str, Any]]:
    cache = read_json(DAILY_OUTCOME_PATH, {})
    references: dict[tuple[str, str], dict[str, Any]] = {}
    for code, series in cache.get("series", {}).items():
        for row in series.get("rows", []):
            date = normalize_date(row.get("date"))
            if date:
                references[(str(code), date)] = {
                    "source": "tencent_qfq_daily_kline_fallback",
                    "date": date,
                    "code": str(code),
                    "open": first_positive(row.get("open")),
                    "high": first_positive(row.get("high")),
                    "low": first_positive(row.get("low")),
                    "close": first_positive(row.get("close")),
                    "amount": first_positive(row.get("amount")),
                }
    return references


def resolve_daily_reference(
    code: str,
    date: str,
    requirement: dict[str, Any],
    raw_references: dict[tuple[str, str], dict[str, Any]],
    qfq_references: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any] | None:
    raw = raw_references.get((code, date))
    qfq = qfq_references.get((code, date))
    bridge_valid = bool(requirement.get("priceBridgeValid") and qfq)
    if raw:
        result = dict(raw)
        supplemented: list[str] = []
        if bridge_valid:
            for key in ("open", "high", "low", "close", "amount"):
                if not result.get(key) and qfq.get(key):
                    result[key] = qfq[key]
                    supplemented.append(key)
        result["source"] = "raw_plus_qfq_daily_bridge" if supplemented else raw["source"]
        result["supplementedFields"] = supplemented
        result["priceBridgeValid"] = bridge_valid
        result["priceDifferencePct"] = requirement.get("priceDifferencePct")
        return result
    if qfq:
        result = dict(qfq)
        result["priceBridgeValid"] = bridge_valid
        result["priceDifferencePct"] = requirement.get("priceDifferencePct")
        return result
    return None


def canonical_column(columns: list[Any], candidates: tuple[str, ...]) -> Any | None:
    normalized = {str(column).strip().lower(): column for column in columns}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    return None


def normalize_frame(frame: pd.DataFrame, source: str) -> list[dict[str, Any]]:
    if frame is None or frame.empty:
        return []
    columns = list(frame.columns)
    mapping = {
        "timestamp": canonical_column(columns, ("day", "时间", "datetime", "date")),
        "open": canonical_column(columns, ("open", "开盘")),
        "high": canonical_column(columns, ("high", "最高")),
        "low": canonical_column(columns, ("low", "最低")),
        "close": canonical_column(columns, ("close", "收盘")),
        "volume": canonical_column(columns, ("volume", "成交量")),
        "amount": canonical_column(columns, ("amount", "成交额")),
    }
    if any(mapping[key] is None for key in ("timestamp", "open", "high", "low", "close")):
        return []
    rows: list[dict[str, Any]] = []
    for _, raw in frame.iterrows():
        timestamp = pd.to_datetime(raw[mapping["timestamp"]], errors="coerce")
        if pd.isna(timestamp):
            continue
        row = {
            "date": timestamp.strftime("%Y-%m-%d"),
            "time": timestamp.strftime("%H:%M"),
            "open": finite(raw[mapping["open"]]),
            "high": finite(raw[mapping["high"]]),
            "low": finite(raw[mapping["low"]]),
            "close": finite(raw[mapping["close"]]),
            "volume": finite(raw[mapping["volume"]]) if mapping["volume"] is not None else None,
            "amount": finite(raw[mapping["amount"]]) if mapping["amount"] is not None else None,
            "source": source,
        }
        if all(row[key] is not None and row[key] > 0 for key in ("open", "high", "low", "close")):
            rows.append(row)
    return sorted(rows, key=lambda row: (row["date"], row["time"]))


def pct_difference(actual: float | None, expected: float | None) -> float | None:
    if not actual or not expected:
        return None
    return abs(actual / expected - 1) * 100


def validate_day(bars: list[dict[str, Any]], reference: dict[str, Any] | None) -> dict[str, Any]:
    if not bars:
        return {"passed": False, "blockers": ["minute_bars_missing"], "metrics": {}}
    aggregate = {
        "barCount": len(bars),
        "open": bars[0]["open"],
        "high": max(row["high"] for row in bars),
        "low": min(row["low"] for row in bars),
        "close": bars[-1]["close"],
        "amount": sum(row["amount"] or 0 for row in bars),
        "firstTime": bars[0]["time"],
        "lastTime": bars[-1]["time"],
    }
    blockers: list[str] = []
    if not (MIN_EXPECTED_BARS <= len(bars) <= MAX_EXPECTED_BARS):
        blockers.append("unexpected_5m_bar_count")
    if len({row["time"] for row in bars}) != len(bars):
        blockers.append("duplicate_bar_time")
    if reference is None:
        blockers.append("raw_daily_reference_missing")
        comparisons = {}
    else:
        comparisons = {
            key: pct_difference(aggregate[key], reference.get(key))
            for key in ("open", "high", "low", "close", "amount")
        }
        for key in ("open", "high", "low", "close"):
            if comparisons[key] is None:
                blockers.append(f"daily_{key}_reference_missing")
            elif comparisons[key] > PRICE_TOLERANCE_PCT:
                blockers.append(f"daily_{key}_mismatch")
        if comparisons["amount"] is None:
            blockers.append("daily_amount_reference_missing")
        elif comparisons["amount"] > AMOUNT_TOLERANCE_PCT:
            blockers.append("daily_amount_mismatch")
        if reference.get("source") != "raw_closing_candidate_snapshot" and reference.get("priceBridgeValid") is not True:
            blockers.append("raw_daily_reference_missing_or_unverified_price_bridge")
    return {
        "passed": not blockers,
        "blockers": sorted(set(blockers)),
        "metrics": aggregate,
        "comparisonsPct": comparisons,
        "dailyReference": reference,
    }


def cross_validate(primary: list[dict[str, Any]], secondary: list[dict[str, Any]]) -> dict[str, Any]:
    if not secondary:
        return {"status": "unavailable", "passed": False, "blockers": ["secondary_source_missing"]}
    left = validate_day(primary, None)["metrics"]
    right = validate_day(secondary, None)["metrics"]
    comparisons = {key: pct_difference(left.get(key), right.get(key)) for key in ("open", "high", "low", "close", "amount")}
    blockers = [f"cross_source_{key}_mismatch" for key, value in comparisons.items()
                if value is not None and value > (AMOUNT_TOLERANCE_PCT if key == "amount" else PRICE_TOLERANCE_PCT)]
    return {"status": "available", "passed": not blockers, "blockers": blockers, "comparisonsPct": comparisons}


def fetch_code(code: str, dates: list[str]) -> dict[str, Any]:
    global EASTMONEY_FAILURES, EASTMONEY_DISABLED
    ak = load_akshare()
    result: dict[str, Any] = {"code": code, "dates": dates, "sources": {}, "errors": {}}
    try:
        frame = ak.stock_zh_a_minute(symbol=sina_symbol(code), period="5", adjust="")
        result["sources"]["sina"] = normalize_frame(frame, "akshare_sina_5m_unadjusted")
    except Exception as error:  # provider errors are part of the audit
        result["sources"]["sina"] = []
        result["errors"]["sina"] = f"{type(error).__name__}: {error}"
    try:
        if EASTMONEY_DISABLED:
            raise RuntimeError("eastmoney_circuit_open_after_repeated_failures")
        start = min(dates) + " 09:30:00"
        end = max(dates) + " 15:00:00"
        frame = ak.stock_zh_a_hist_min_em(symbol=code, start_date=start, end_date=end, period="5", adjust="")
        result["sources"]["eastmoney"] = normalize_frame(frame, "akshare_eastmoney_5m_unadjusted")
        if result["sources"]["eastmoney"]:
            EASTMONEY_FAILURES = 0
    except Exception as error:
        result["sources"]["eastmoney"] = []
        result["errors"]["eastmoney"] = f"{type(error).__name__}: {error}"
        EASTMONEY_FAILURES += 1
        if EASTMONEY_FAILURES >= 3:
            EASTMONEY_DISABLED = True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="write validated bars to the formal minute outcome cache")
    parser.add_argument("--audit-existing", action="store_true", help="refresh existing validation-cache metadata without network requests")
    parser.add_argument("--delay-ms", type=int, default=350)
    args = parser.parse_args()
    if args.audit_existing:
        existing = read_json(FULL_OUTPUT_PATH, {})
        summary = existing.get("qualitySummary", {})
        summary["validationCacheWriteAllowed"] = bool(summary.get("validPairCount"))
        summary["formalWriteAllowed"] = False
        summary["formalWriteBlocker"] = "validation_data_never_grants_trading_authority"
        existing["qualitySummary"] = summary
        existing["executionAuthority"] = False
        write_json(FULL_OUTPUT_PATH, existing)
        print(json.dumps({"output": str(FULL_OUTPUT_PATH), **summary}, ensure_ascii=False, indent=2))
        return 0
    requirements = load_requirements()
    ak = load_akshare()
    selected = requirements if args.full else select_pilot(requirements)
    raw_references = load_raw_daily_references()
    qfq_references = load_qfq_daily_references()
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in selected:
        by_code[row["code"]].append(row)

    output: dict[str, Any] = {
        "schemaVersion": 1,
        "authority": "akshare_5m_execution_validation_v1",
        "executionAuthority": False,
        "mode": "full" if args.full else "pilot",
        "generatedAt": datetime.now().astimezone().isoformat(),
        "akshareVersion": getattr(ak, "__version__", "unknown"),
        "requirements": selected,
        "series": {},
        "qualitySummary": {},
        "rules": {
            "adjust": "unadjusted",
            "priceTolerancePct": PRICE_TOLERANCE_PCT,
            "amountTolerancePct": AMOUNT_TOLERANCE_PCT,
            "expected5mBars": [MIN_EXPECTED_BARS, MAX_EXPECTED_BARS],
            "missingPolicy": "unavailable_no_synthetic_fill",
        },
    }
    counters: Counter[str] = Counter()
    for index, (code, rows) in enumerate(sorted(by_code.items()), start=1):
        dates = sorted({row["nextDate"] for row in rows})
        fetched = fetch_code(code, dates)
        primary_rows = fetched["sources"].get("sina", [])
        secondary_rows = fetched["sources"].get("eastmoney", [])
        days: dict[str, Any] = {}
        minute_rows_by_date: dict[str, list[dict[str, Any]]] = {}
        for date in dates:
            primary = [row for row in primary_rows if row["date"] == date]
            secondary = [row for row in secondary_rows if row["date"] == date]
            requirement = next((row for row in rows if row["nextDate"] == date), {})
            reference = resolve_daily_reference(code, date, requirement, raw_references, qfq_references)
            validation = validate_day(primary, reference)
            cross = cross_validate(primary, secondary) if primary else {
                "status": "not_applicable", "passed": False, "blockers": ["primary_source_missing"]
            }
            valid = validation["passed"]
            counters["valid" if valid else "invalid"] += 1
            if not primary:
                counters["sina_missing"] += 1
            if not secondary:
                counters["eastmoney_missing"] += 1
            days[date] = {
                "validForExecutionReplay": valid,
                "primarySource": "akshare_sina_5m_unadjusted" if primary else None,
                "barCount": len(primary),
                "validation": validation,
                "crossSource": cross,
                "providerErrors": fetched["errors"],
            }
            if valid:
                minute_rows_by_date[date] = primary
        output["series"][code] = {
            "code": code,
            "name": rows[0]["name"],
            "minuteRowsByDate": minute_rows_by_date,
            "qualityByDate": days,
        }
        print(f"[{index}/{len(by_code)}] {code} {rows[0]['name']} dates={len(dates)} valid={sum(1 for day in days.values() if day['validForExecutionReplay'])}", flush=True)
        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000)

    output["qualitySummary"] = {
        "requestedPairCount": len(selected),
        "validPairCount": counters["valid"],
        "invalidPairCount": counters["invalid"],
        "sinaMissingCount": counters["sina_missing"],
        "eastmoneyMissingCount": counters["eastmoney_missing"],
        "coveragePct": round(counters["valid"] / len(selected) * 100, 2) if selected else 0,
        "validationCacheWriteAllowed": bool(args.full and counters["valid"] > 0),
        "formalWriteAllowed": False,
        "formalWriteBlocker": "validation_data_never_grants_trading_authority",
    }
    target = FULL_OUTPUT_PATH if args.full else PILOT_OUTPUT_PATH
    write_json(target, output)
    print(json.dumps({"output": str(target), **output["qualitySummary"]}, ensure_ascii=False, indent=2))
    return 0 if counters["valid"] > 0 else 2


if __name__ == "__main__":
    sys.exit(main())
