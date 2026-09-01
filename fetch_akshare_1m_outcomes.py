"""Archive free AKShare/Sina raw A-share one-minute evidence.

This is deliberately separate from ``fetch_akshare_minute_outcomes.py``.  The
older script remains a five-minute legacy-entry validator; this file produces
only Tier-2 V7 one-minute candidates.

The Sina endpoint exposes a rolling free window rather than a date parameter.
Every requested CODE@DATE pair therefore has to be present verbatim in the
provider response and pass the complete 240-bar post-close schedule.  Missing,
partial, malformed, adjusted, provider-error, or out-of-window data remain
unavailable and never gain execution authority.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from fetch_jqdata_minute_outcomes import (
    CANONICAL_MINUTE_HASH_SCOPE,
    DATA_DIR,
    DEFAULT_REQUIREMENTS_PATH,
    EXPECTED_BAR_COUNT,
    InputContractError,
    Requirement,
    SHANGHAI_TZ,
    canonical_json_hash,
    expected_minute_timestamps,
    js_number,
    load_validation_requirements,
    normalize_trading_date,
    parse_explicit_pair,
    resolve_output_path,
    six_digit_code,
    write_json_atomic,
)


DEFAULT_OUTPUT_PATH = DATA_DIR / "akshare-sina-1m-outcomes.json"
PROVIDER_NAME = "AKShare"
PROVIDER_ADAPTER = "Sina"
AUTHORITY = "akshare_sina_1m_execution_validation_v1"
SOURCE = "akshare_sina_1m_unadjusted"
TIMESTAMP_CONVENTION = "BAR_END_ASIA_SHANGHAI"


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def sina_symbol(value: Any) -> str:
    code = six_digit_code(value)
    if code.startswith(("4", "8", "92")):
        return f"bj{code}"
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def timestamp_value(value: Any) -> datetime | None:
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(SHANGHAI_TZ).replace(tzinfo=None)
    return parsed.replace(microsecond=0)


def frame_records(frame: Any) -> list[dict[str, Any]]:
    if frame is None or not hasattr(frame, "to_dict"):
        return []
    rows = frame.to_dict(orient="records")
    return [row for row in rows if isinstance(row, dict)]


def field_value(row: dict[str, Any], *names: str) -> Any:
    normalized = {str(key).strip().lower(): value for key, value in row.items()}
    for name in names:
        if name.lower() in normalized:
            return normalized[name.lower()]
    return None


def normalize_frame(frame: Any) -> list[dict[str, Any]]:
    """Normalize without sorting or dropping malformed rows.

    Preserving provider order is intentional: a provider response cannot become
    valid merely because the adapter sorted or removed bad rows.
    """

    result: list[dict[str, Any]] = []
    for raw in frame_records(frame):
        timestamp = timestamp_value(field_value(raw, "day", "datetime", "date", "time"))
        result.append({
            "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S") if timestamp else None,
            "open": finite_number(field_value(raw, "open", "开盘")),
            "high": finite_number(field_value(raw, "high", "最高")),
            "low": finite_number(field_value(raw, "low", "最低")),
            "close": finite_number(field_value(raw, "close", "收盘")),
            "volume": finite_number(field_value(raw, "volume", "成交量")),
            "amount": finite_number(field_value(raw, "amount", "money", "成交额")),
        })
    return result


def canonical_minute_bar(row: dict[str, Any]) -> dict[str, Any]:
    timestamp = timestamp_value(row.get("timestamp") or row.get("datetime") or row.get("date"))
    return {
        "date": timestamp.strftime("%Y-%m-%d") if timestamp else None,
        "time": timestamp.strftime("%H:%M") if timestamp else None,
        "open": js_number(row.get("open")),
        "high": js_number(row.get("high")),
        "low": js_number(row.get("low")),
        "close": js_number(row.get("close")),
        "volume": js_number(row.get("volume")),
        "amount": js_number(row.get("amount") if "amount" in row else row.get("money")),
    }


def minute_content_hash(bars: Sequence[dict[str, Any]]) -> str:
    return canonical_json_hash([canonical_minute_bar(dict(row)) for row in bars])


def validate_bars(bars: Sequence[dict[str, Any]], trading_date: str) -> dict[str, Any]:
    expected = expected_minute_timestamps(trading_date)
    timestamps = [row.get("timestamp") for row in bars]
    valid_timestamps = [value for value in timestamps if isinstance(value, str)]
    actual_set = set(valid_timestamps)
    expected_set = set(expected)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    duplicate_count = len(valid_timestamps) - len(actual_set)
    exact_order = timestamps == expected
    fields_complete = True
    ohlc_consistent = True
    volume_amount_non_negative = True
    total_volume = 0.0
    total_amount = 0.0

    for row in bars:
        open_price, high, low, close, volume, amount = (
            finite_number(row.get(field))
            for field in ("open", "high", "low", "close", "volume", "amount")
        )
        if any(value is None for value in (open_price, high, low, close, volume, amount)):
            fields_complete = False
            continue
        assert open_price is not None and high is not None and low is not None and close is not None
        assert volume is not None and amount is not None
        if min(open_price, high, low, close) <= 0:
            fields_complete = False
        if high < max(open_price, close) or low > min(open_price, close) or high < low:
            ohlc_consistent = False
        if volume < 0 or amount < 0:
            volume_amount_non_negative = False
        total_volume += volume
        total_amount += amount

    positive_daily_trading = total_volume > 0 and total_amount > 0
    blockers: list[str] = []
    if len(bars) != EXPECTED_BAR_COUNT:
        blockers.append("unexpected_1m_bar_count")
    if missing:
        blockers.append("minute_schedule_missing")
    if extra:
        blockers.append("minute_schedule_extra")
    if duplicate_count:
        blockers.append("duplicate_minute_timestamp")
    if not exact_order:
        blockers.append("minute_schedule_not_exactly_ordered")
    if not fields_complete:
        blockers.append("ohlcv_amount_incomplete_or_non_positive_price")
    if not ohlc_consistent:
        blockers.append("ohlc_internally_inconsistent")
    if not volume_amount_non_negative:
        blockers.append("negative_volume_or_amount")
    if not positive_daily_trading:
        blockers.append("daily_trading_volume_or_amount_not_positive")

    return {
        "expectedBarCount": EXPECTED_BAR_COUNT,
        "actualBarCount": len(bars),
        "firstTimestamp": valid_timestamps[0] if valid_timestamps else None,
        "lastTimestamp": valid_timestamps[-1] if valid_timestamps else None,
        "exactTradingSchedule": bool(not missing and not extra and not duplicate_count and exact_order),
        "timestampsOrdered": exact_order,
        "duplicateTimestampCount": duplicate_count,
        "missingTimestampCount": len(missing),
        "extraTimestampCount": len(extra),
        "missingTimestamps": missing,
        "extraTimestamps": extra,
        "ohlcvAmountComplete": fields_complete,
        "ohlcInternallyConsistent": ohlc_consistent,
        "volumeAmountNonNegative": volume_amount_non_negative,
        "dailyVolume": js_number(total_volume),
        "dailyAmount": js_number(total_amount),
        "positiveDailyTrading": positive_daily_trading,
        "blockers": blockers,
        "passed": not blockers,
    }


def requirement_json(requirement: Requirement) -> dict[str, str]:
    return {
        "code": six_digit_code(requirement.code),
        "symbol": sina_symbol(requirement.code),
        "tradingDate": requirement.trading_date,
        "signalDate": requirement.signal_date,
        "source": requirement.source,
    }


def provider_window(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    dates = sorted({
        str(row["timestamp"])[:10]
        for row in rows
        if isinstance(row.get("timestamp"), str)
    })
    return {
        "startDate": dates[0] if dates else None,
        "endDate": dates[-1] if dates else None,
        "returnedTradingDates": dates,
    }


def base_record(requirement: Requirement, provider_version: str) -> dict[str, Any]:
    return {
        "provider": PROVIDER_NAME,
        "adapter": PROVIDER_ADAPTER,
        "source": SOURCE,
        "authority": AUTHORITY,
        "providerVersion": provider_version,
        "code": six_digit_code(requirement.code),
        "symbol": sina_symbol(requirement.code),
        "tradingDate": requirement.trading_date,
        "barIntervalMinutes": 1,
        "timestampConvention": TIMESTAMP_CONVENTION,
        "priceMode": "raw_unadjusted",
        "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
        "validForExecutionReplay": False,
        "validForV7": False,
        "executionAuthority": False,
    }


def record_from_rows(
    requirement: Requirement,
    provider_version: str,
    all_rows: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    base = base_record(requirement, provider_version)
    window = provider_window(all_rows)
    requested_rows = [
        dict(row) for row in all_rows
        if isinstance(row.get("timestamp"), str)
        and str(row["timestamp"])[:10] == requirement.trading_date
    ]
    if requirement.trading_date not in window["returnedTradingDates"]:
        return {
            **base,
            "status": "date_outside_free_window_or_not_returned",
            "bars": [],
            "contentHash": None,
            "providerWindow": window,
            "scheduleQuality": {
                "expectedBarCount": EXPECTED_BAR_COUNT,
                "actualBarCount": 0,
                "blockers": ["requested_date_not_in_provider_free_window"],
                "passed": False,
            },
            "error": None,
        }

    quality = validate_bars(requested_rows, requirement.trading_date)
    return {
        **base,
        "status": "valid" if quality["passed"] else "data_quality_failed",
        "validForExecutionReplay": bool(quality["passed"]),
        "validForV7": bool(quality["passed"]),
        "bars": requested_rows,
        "contentHash": minute_content_hash(requested_rows),
        "providerWindow": window,
        "scheduleQuality": quality,
        "error": None,
    }


def provider_error_record(
    requirement: Requirement,
    provider_version: str,
    error: Exception,
) -> dict[str, Any]:
    return {
        **base_record(requirement, provider_version),
        "status": "provider_or_permission_error",
        "bars": [],
        "contentHash": None,
        "providerWindow": {"startDate": None, "endDate": None, "returnedTradingDates": []},
        "scheduleQuality": {
            "expectedBarCount": EXPECTED_BAR_COUNT,
            "actualBarCount": 0,
            "blockers": ["provider_or_permission_error"],
            "passed": False,
        },
        "error": {
            "code": "provider_or_permission_error",
            "type": type(error).__name__,
        },
    }


def fetch_symbol_rows(provider: Any, code: str) -> list[dict[str, Any]]:
    frame = provider.stock_zh_a_minute(
        symbol=sina_symbol(code),
        period="1",
        adjust="",
    )
    return normalize_frame(frame)


def build_output(provider: Any, requirements: Sequence[Requirement]) -> dict[str, Any]:
    provider_version = str(getattr(provider, "__version__", "unknown") or "unknown")
    grouped: dict[str, list[Requirement]] = defaultdict(list)
    for requirement in requirements:
        grouped[six_digit_code(requirement.code)].append(requirement)

    records: list[dict[str, Any]] = []
    for code, code_requirements in sorted(grouped.items()):
        try:
            all_rows = fetch_symbol_rows(provider, code)
        except Exception as error:  # network, provider, and permission failures are audit state
            records.extend(provider_error_record(row, provider_version, error) for row in code_requirements)
            continue
        records.extend(record_from_rows(row, provider_version, all_rows) for row in code_requirements)

    records.sort(key=lambda row: (row["tradingDate"], row["code"]))
    valid_count = sum(row["validForV7"] is True for row in records)
    provider_error_count = sum(row["status"] == "provider_or_permission_error" for row in records)
    outside_window_count = sum(row["status"] == "date_outside_free_window_or_not_returned" for row in records)
    invalid_count = len(records) - valid_count
    return {
        "schemaVersion": 1,
        "authority": AUTHORITY,
        "source": SOURCE,
        "executionAuthority": False,
        "generatedAt": datetime.now(SHANGHAI_TZ).isoformat(),
        "provider": {
            "name": PROVIDER_NAME,
            "adapter": PROVIDER_ADAPTER,
            "sdk": "akshare",
            "version": provider_version,
        },
        "barIntervalMinutes": 1,
        "timestampConvention": TIMESTAMP_CONVENTION,
        "priceMode": "raw_unadjusted",
        "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
        "requirements": [requirement_json(row) for row in requirements],
        "records": records,
        "rules": {
            "endpoint": "stock_zh_a_minute",
            "providerSymbol": "Sina exchange-prefixed A-share symbol",
            "periodArgument": "1",
            "adjustArgument": "",
            "expectedDailyBarCount": EXPECTED_BAR_COUNT,
            "sessionTimestamps": "09:31-11:30,13:01-15:00 Asia/Shanghai",
            "freeWindowPolicy": "requested_date_must_be_returned_exactly_no_nearest_date_fallback",
            "missingOrInvalidPolicy": "unavailable_no_synthetic_fill_no_cross_source_splice",
            "purpose": "tier2_v7_price_evidence_only",
        },
        "qualitySummary": {
            "requestedPairCount": len(records),
            "validPairCount": valid_count,
            "invalidPairCount": invalid_count,
            "providerErrorCount": provider_error_count,
            "outsideFreeWindowCount": outside_window_count,
            "coveragePct": round(valid_count / len(records) * 100, 4) if records else 0,
            "allRequestedPairsValid": bool(records and invalid_count == 0),
            "formalTradingAuthority": False,
        },
    }


def load_akshare() -> Any:
    try:
        import akshare as ak  # pylint: disable=import-outside-toplevel
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "akshare is required; install requirements-akshare.txt in data/.venv-akshare"
        ) from error
    return ak


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Archive exact free AKShare/Sina raw one-minute CODE@DATE evidence."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--pair",
        action="append",
        metavar="CODE@YYYY-MM-DD",
        help="exact stock/date pair; repeat for additional pairs",
    )
    mode.add_argument(
        "--requirements",
        action="store_true",
        help="fetch exact pairs already present in the validation report",
    )
    parser.add_argument("--requirements-report", default=str(DEFAULT_REQUIREMENTS_PATH))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    return parser.parse_args(argv)


def requested_requirements(args: argparse.Namespace) -> list[Requirement]:
    if args.limit < 0:
        raise InputContractError("limit cannot be negative")
    if args.pair:
        requirements = [parse_explicit_pair(value) for value in args.pair]
    else:
        path = Path(args.requirements_report).expanduser()
        if not path.is_absolute():
            path = Path(__file__).resolve().parent / path
        requirements = load_validation_requirements(path.resolve())
    unique: dict[tuple[str, str], Requirement] = {}
    for requirement in requirements:
        code = six_digit_code(requirement.code)
        trading_date = normalize_trading_date(requirement.trading_date)
        unique[(code, trading_date)] = Requirement(
            code=code,
            trading_date=trading_date,
            signal_date=requirement.signal_date,
            source=requirement.source,
        )
    requirements = sorted(unique.values())
    if args.limit:
        requirements = requirements[: args.limit]
    if not requirements:
        raise InputContractError("at least one exact stock/date pair is required")
    return requirements


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_arguments(argv)
        requirements = requested_requirements(args)
        output_path = resolve_output_path(args.output)
        output = build_output(load_akshare(), requirements)
        write_json_atomic(output_path, output)
        summary = output["qualitySummary"]
        print(json.dumps({
            "ok": summary["allRequestedPairsValid"],
            "output": str(output_path),
            **summary,
        }, ensure_ascii=False, indent=2))
        return 0 if summary["allRequestedPairsValid"] else 4
    except InputContractError as error:
        print(json.dumps({"ok": False, "reason": "input_contract_error", "error": str(error)}, ensure_ascii=False))
        return 2
    except RuntimeError as error:
        print(json.dumps({"ok": False, "reason": "runtime_dependency_error", "error": str(error)}, ensure_ascii=False))
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
