"""Read-only JQData capability probe.

Credentials are collected in a local masked dialog (or console fallback), used
only for the current process, and never written to disk or included in output.
The report contains capability and data-quality summaries only.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import math
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DEFAULT_REPORT = ROOT / "data" / "reports" / "jqdata-probe.json"


def finite(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def local_credentials() -> tuple[str, str]:
    username = os.environ.get("JQDATA_USER", "").strip()
    password = os.environ.get("JQDATA_PASSWORD", "")
    if username and password:
        os.environ.pop("JQDATA_USER", None)
        os.environ.pop("JQDATA_PASSWORD", None)
        return username, password

    try:
        import tkinter as tk
        from tkinter import messagebox, simpledialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        username = simpledialog.askstring("JQData只读探针", "聚宽/JQData账号：", parent=root) or ""
        password = simpledialog.askstring(
            "JQData只读探针",
            "密码（不会保存）：",
            show="*",
            parent=root,
        ) or ""
        if not username.strip() or not password:
            messagebox.showwarning("JQData只读探针", "未输入完整凭证，探针已取消。", parent=root)
        root.destroy()
        return username.strip(), password
    except Exception:
        if not sys.stdin.isatty():
            return "", ""
        username = input("JQData username: ").strip()
        password = getpass.getpass("JQData password (hidden): ")
        return username, password


def normalize_code(value: str) -> str:
    text = str(value or "").strip().upper()
    if "." in text:
        return text
    code = "".join(ch for ch in text if ch.isdigit())[-6:]
    if len(code) != 6:
        raise ValueError("code must be a six-digit A-share code or JoinQuant code")
    return f"{code}.XSHG" if code.startswith(("5", "6", "9")) else f"{code}.XSHE"


def frame_rows(frame: Any) -> list[dict[str, Any]]:
    if frame is None or not hasattr(frame, "reset_index"):
        return []
    reset = frame.reset_index()
    rows: list[dict[str, Any]] = []
    for raw in reset.to_dict(orient="records"):
        row: dict[str, Any] = {}
        for key, value in raw.items():
            if hasattr(value, "isoformat"):
                row[str(key)] = value.isoformat(sep=" ")
            elif hasattr(value, "item"):
                row[str(key)] = value.item()
            else:
                row[str(key)] = value
        rows.append(row)
    return rows


def timestamp_of(row: dict[str, Any]) -> datetime | None:
    for key in ("date", "time", "datetime", "index"):
        value = row.get(key)
        if value is None:
            continue
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            continue
    return None


def summarize_bars(rows: list[dict[str, Any]], trading_date: str) -> dict[str, Any]:
    timestamps = [value for row in rows if (value := timestamp_of(row)) is not None]
    unique = len(set(timestamps)) == len(timestamps)
    ordered = timestamps == sorted(timestamps)
    same_date = all(value.strftime("%Y-%m-%d") == trading_date for value in timestamps)
    gaps = [int((right - left).total_seconds() // 60) for left, right in zip(timestamps, timestamps[1:])]
    legal_gaps = all(gap == 1 or gap >= 60 for gap in gaps)
    price_fields_present = all(
        finite(row.get(key)) is not None
        for row in rows
        for key in ("open", "high", "low", "close")
    ) if rows else False
    return {
        "rowCount": len(rows),
        "firstTimestamp": timestamps[0].isoformat(sep=" ") if timestamps else None,
        "lastTimestamp": timestamps[-1].isoformat(sep=" ") if timestamps else None,
        "columns": sorted({str(key) for row in rows for key in row}),
        "timestampsUnique": unique,
        "timestampsOrdered": ordered,
        "sameTradingDate": same_date,
        "oneMinuteOrSessionBreakGaps": legal_gaps,
        "gapHistogramMinutes": {str(gap): gaps.count(gap) for gap in sorted(set(gaps))},
        "priceFieldsPresent": price_fields_present,
        "rawContentHash": canonical_hash(rows),
        "passed": bool(rows and unique and ordered and same_date and legal_gaps and price_fields_present),
    }


def summarize_ticks(rows: list[dict[str, Any]]) -> dict[str, Any]:
    timestamps = [value for row in rows if (value := timestamp_of(row)) is not None]
    b1_rows = [row for row in rows if finite(row.get("b1_p")) is not None and finite(row.get("b1_v")) is not None]
    quote_only_changes = 0
    for left, right in zip(rows, rows[1:]):
        same_volume = finite(left.get("volume")) == finite(right.get("volume"))
        bid_changed = (
            finite(left.get("b1_p")) != finite(right.get("b1_p"))
            or finite(left.get("b1_v")) != finite(right.get("b1_v"))
        )
        if same_volume and bid_changed:
            quote_only_changes += 1
    seconds = [
        (right - left).total_seconds()
        for left, right in zip(timestamps, timestamps[1:])
        if right >= left
    ]
    return {
        "rowCount": len(rows),
        "firstTimestamp": timestamps[0].isoformat(sep=" ") if timestamps else None,
        "lastTimestamp": timestamps[-1].isoformat(sep=" ") if timestamps else None,
        "columns": sorted({str(key) for row in rows for key in row}),
        "bid1RowCount": len(b1_rows),
        "bid1CoveragePct": round(len(b1_rows) / len(rows) * 100, 4) if rows else 0,
        "quoteOnlyBidChangeCount": quote_only_changes,
        "medianSnapshotGapSeconds": sorted(seconds)[len(seconds) // 2] if seconds else None,
        "rawContentHash": canonical_hash(rows),
        "supportsThirtySecondSealAudit": bool(len(b1_rows) and quote_only_changes),
    }


def select_probe_date(jq: Any, requested: str | None) -> str:
    if requested:
        return requested
    completed_cutoff = date.today() - timedelta(days=1)
    days = jq.get_trade_days(end_date=completed_cutoff, count=1)
    if not len(days):
        raise RuntimeError("no completed trading date returned")
    value = days[-1]
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)[:10]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", default="000001.XSHE")
    parser.add_argument("--date", default=None, help="completed trading date YYYY-MM-DD")
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    args = parser.parse_args()

    username, password = local_credentials()
    if not username or not password:
        print(json.dumps({"ok": False, "reason": "credentials_not_provided"}, ensure_ascii=False))
        return 2

    import jqdatasdk as jq

    try:
        jq.auth(username, password)
        trading_date = select_probe_date(jq, args.date)
        code = normalize_code(args.code)
        bars = jq.get_bars(
            code,
            unit="1m",
            fields=("date", "open", "high", "low", "close", "volume", "money"),
            include_now=True,
            start_dt=f"{trading_date} 09:25:00",
            end_dt=f"{trading_date} 15:00:00",
            fq_ref_date=None,
            df=True,
            skip_paused=False,
        )
        tick_error: dict[str, Any] | None = None
        try:
            ticks = jq.get_ticks(
                code,
                start_dt=f"{trading_date} 09:25:00",
                end_dt=f"{trading_date} 15:00:00",
                fields=("time", "current", "high", "low", "volume", "money", "b1_p", "b1_v", "a1_p", "a1_v"),
                skip=False,
                df=True,
            )
        except Exception as error:
            ticks = None
            tick_error = {
                "code": "tick_unavailable_or_not_permitted",
                "errorType": type(error).__name__,
            }
        query_count = jq.get_query_count()
        bar_rows = frame_rows(bars)
        tick_rows = frame_rows(ticks)
        tick_summary = summarize_ticks(tick_rows)
        if tick_error:
            tick_summary["available"] = False
            tick_summary["permissionError"] = tick_error
        else:
            tick_summary["available"] = True
        report = {
            "schemaVersion": 1,
            "authority": "jqdata_read_only_capability_probe_v1",
            "executionAuthority": False,
            "generatedAt": datetime.now().astimezone().isoformat(),
            "jqdatasdkVersion": getattr(jq, "__version__", None),
            "code": code,
            "tradingDate": trading_date,
            "queryCountAfterProbe": query_count,
            "oneMinuteBars": summarize_bars(bar_rows, trading_date),
            "ticks": tick_summary,
            "credentialsPersisted": False,
            "rules": {
                "priceMode": "raw_unadjusted",
                "tickSkip": False,
                "missingPolicy": "unavailable_no_proxy",
            },
        }
        report["oneMinutePassed"] = bool(report["oneMinuteBars"]["passed"])
        report["sealTickPassed"] = bool(report["ticks"]["bid1RowCount"] > 0)
        report["passed"] = bool(report["oneMinutePassed"] and report["sealTickPassed"])
        target = Path(args.report).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target)
        print(json.dumps({
            "ok": True,
            "passed": report["passed"],
            "oneMinutePassed": report["oneMinutePassed"],
            "sealTickPassed": report["sealTickPassed"],
            "report": str(target),
            "code": code,
            "tradingDate": trading_date,
            "oneMinuteRows": report["oneMinuteBars"]["rowCount"],
            "tickRows": report["ticks"]["rowCount"],
            "bid1CoveragePct": report["ticks"]["bid1CoveragePct"],
            "quoteOnlyBidChangeCount": report["ticks"]["quoteOnlyBidChangeCount"],
        }, ensure_ascii=False, indent=2))
        return 0 if report["passed"] else 3
    except Exception as error:  # provider/auth failures are probe evidence
        print(json.dumps({
            "ok": False,
            "reason": "jqdata_probe_failed",
            "errorType": type(error).__name__,
        }, ensure_ascii=False, indent=2))
        return 1
    finally:
        password = ""
        username = ""


if __name__ == "__main__":
    raise SystemExit(main())
