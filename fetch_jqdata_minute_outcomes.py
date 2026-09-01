"""Fetch validation-only A-share 1-minute bars from JQData.

The fetcher is deliberately narrow:

* it accepts only exact stock/date pairs or pairs already present in the
  factor-effectiveness validation report;
* credentials come from the process environment, a masked local dialog, or a
  masked terminal prompt and are never written to disk;
* JQData is queried with ``fq_ref_date=None`` (raw, unadjusted prices);
* every day must match the exact 240-bar A-share session schedule and contain
  complete, internally consistent OHLCV/money fields;
* provider, permission, schema, and data-quality failures remain unavailable
  and never grant trading or execution authority.

The default cache lives below ``data/``, which is ignored by this repository.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable, Sequence
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DEFAULT_REQUIREMENTS_PATH = DATA_DIR / "reports" / "factor-effectiveness-validation-latest.json"
DEFAULT_OUTPUT_PATH = DATA_DIR / "jqdata-minute-outcomes.json"
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
EXPECTED_BAR_COUNT = 240
PROVIDER_NAME = "JQData"
AUTHORITY = "jqdata_1m_execution_validation_v1"
CANONICAL_MINUTE_HASH_SCOPE = "canonical_a_share_1m_ohlcv_v1"


class InputContractError(ValueError):
    """The caller requested data outside the fetcher's narrow contract."""


class CredentialError(RuntimeError):
    """Credentials were unavailable or JQData authentication failed."""


@dataclass(frozen=True, order=True)
class Requirement:
    """One explicitly requested stock/trading-date pair."""

    code: str
    trading_date: str
    signal_date: str = ""
    source: str = "explicit_pair"

    @property
    def jq_code(self) -> str:
        return normalize_jq_code(self.code)

    def as_json(self) -> dict[str, str]:
        return {
            "code": six_digit_code(self.code),
            "jqCode": self.jq_code,
            "tradingDate": self.trading_date,
            "signalDate": self.signal_date,
            "source": self.source,
        }


def canonical_json_hash(value: Any) -> str:
    """Return a stable SHA-256 hash for normalized JSON content."""

    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def js_number(value: Any) -> int | float | None:
    """Normalize finite numbers to the representation used by JSON.stringify."""

    number = finite_number(value)
    if number is None:
        return None
    return int(number) if number.is_integer() else number


def canonical_minute_bar(row: dict[str, Any]) -> dict[str, Any]:
    timestamp = _timestamp(row.get("timestamp") or row.get("datetime") or row.get("date"))
    return {
        "date": timestamp.strftime("%Y-%m-%d") if timestamp else None,
        "time": timestamp.strftime("%H:%M") if timestamp else None,
        "open": js_number(row.get("open")),
        "high": js_number(row.get("high")),
        "low": js_number(row.get("low")),
        "close": js_number(row.get("close")),
        "volume": js_number(row.get("volume")),
        "amount": js_number(row.get("money") if "money" in row else row.get("amount")),
    }


def minute_content_hash(bars: Sequence[dict[str, Any]]) -> str:
    return canonical_json_hash([canonical_minute_bar(dict(row)) for row in bars])


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def six_digit_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    if "." in text:
        text = text.split(".", 1)[0]
    digits = "".join(character for character in text if character.isdigit())
    if len(digits) != 6:
        raise InputContractError("stock code must contain exactly six digits")
    return digits


def normalize_jq_code(value: Any) -> str:
    """Normalize a six-digit A-share code to JQData's exchange suffix."""

    text = str(value or "").strip().upper()
    if "." in text:
        code, suffix = text.split(".", 1)
        code = six_digit_code(code)
        suffix = suffix.upper()
        if code.startswith(("4", "8", "92")) or suffix in {"XBSE", "XBEI"}:
            raise InputContractError(
                "JQData Beijing Stock Exchange mapping is unverified; BSE requests fail closed"
            )
        if suffix not in {"XSHG", "XSHE"}:
            raise InputContractError(f"unsupported JQData exchange suffix: {suffix}")
        expected_suffix = "XSHG" if code.startswith(("5", "6", "9")) else "XSHE"
        if suffix != expected_suffix:
            raise InputContractError("stock code and JQData exchange suffix are inconsistent")
        return f"{code}.{suffix}"
    code = six_digit_code(text)
    if code.startswith(("4", "8", "92")):
        raise InputContractError(
            "JQData Beijing Stock Exchange mapping is unverified; BSE requests fail closed"
        )
    if code.startswith(("5", "6", "9")):
        suffix = "XSHG"
    else:
        suffix = "XSHE"
    return f"{code}.{suffix}"


def normalize_trading_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        parsed = date.fromisoformat(text)
    except ValueError as error:
        raise InputContractError("trading date must use YYYY-MM-DD") from error
    if parsed > datetime.now(SHANGHAI_TZ).date():
        raise InputContractError("future trading dates are not allowed")
    return parsed.isoformat()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise InputContractError(f"requirements report not found: {path}") from error
    except json.JSONDecodeError as error:
        raise InputContractError(f"requirements report is not valid JSON: {path}") from error
    if not isinstance(value, dict):
        raise InputContractError("requirements report root must be an object")
    return value


def load_validation_requirements(path: Path) -> list[Requirement]:
    """Read only the exact T+1 pairs already selected by validation."""

    report = read_json(path)
    requirements: dict[tuple[str, str], Requirement] = {}
    days = report.get("rankingStudy", {}).get("days", [])
    if not isinstance(days, list):
        raise InputContractError("validation report rankingStudy.days must be an array")
    for day_row in days:
        if not isinstance(day_row, dict):
            continue
        next_date_raw = day_row.get("nextDate")
        if not next_date_raw:
            continue
        trading_date = normalize_trading_date(str(next_date_raw)[:10])
        signal_date = str(day_row.get("tradingDate") or "")[:10]
        if signal_date:
            signal_date = normalize_trading_date(signal_date)
        selected = day_row.get("unifiedOrder", [])
        if not isinstance(selected, list):
            continue
        for stock in selected:
            if not isinstance(stock, dict):
                continue
            code = six_digit_code(stock.get("code") or stock.get("secCode"))
            key = (code, trading_date)
            requirements[key] = Requirement(
                code=code,
                trading_date=trading_date,
                signal_date=signal_date,
                source="factor_effectiveness_validation_requirement",
            )
    if not requirements:
        raise InputContractError("validation report contains no exact stock/date requirements")
    return sorted(requirements.values())


def parse_explicit_pair(value: str) -> Requirement:
    separator = "@" if "@" in value else ":" if ":" in value else None
    if separator is None:
        raise InputContractError("pair must use CODE@YYYY-MM-DD")
    raw_code, raw_date = value.rsplit(separator, 1)
    return Requirement(
        code=six_digit_code(raw_code),
        trading_date=normalize_trading_date(raw_date),
    )


def deduplicate_requirements(values: Iterable[Requirement]) -> list[Requirement]:
    unique: dict[tuple[str, str], Requirement] = {}
    for requirement in values:
        key = (six_digit_code(requirement.code), normalize_trading_date(requirement.trading_date))
        # Validate the provider mapping before loading credentials or making
        # any network request. Unsupported exchanges fail at input resolution.
        normalize_jq_code(key[0])
        unique[key] = Requirement(
            code=key[0],
            trading_date=key[1],
            signal_date=requirement.signal_date,
            source=requirement.source,
        )
    return sorted(unique.values())


def expected_minute_timestamps(trading_date: str) -> list[str]:
    """Return the exact 240 end-of-minute timestamps for a normal A-share day."""

    day = date.fromisoformat(normalize_trading_date(trading_date))
    sessions = ((time(9, 31), time(11, 30)), (time(13, 1), time(15, 0)))
    result: list[str] = []
    for start_time, end_time in sessions:
        cursor = datetime.combine(day, start_time)
        end = datetime.combine(day, end_time)
        while cursor <= end:
            result.append(cursor.strftime("%Y-%m-%d %H:%M:%S"))
            cursor += timedelta(minutes=1)
    if len(result) != EXPECTED_BAR_COUNT:  # pragma: no cover - developer invariant
        raise RuntimeError("internal A-share minute schedule is not 240 bars")
    return result


def _timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(SHANGHAI_TZ).replace(tzinfo=None)
    return parsed.replace(microsecond=0)


def frame_records(frame: Any) -> list[dict[str, Any]]:
    """Convert a JQData DataFrame to plain records without requiring pandas here."""

    if frame is None or not hasattr(frame, "reset_index"):
        return []
    reset = frame.reset_index()
    if not hasattr(reset, "to_dict"):
        return []
    raw_records = reset.to_dict(orient="records")
    return [record for record in raw_records if isinstance(record, dict)]


def normalize_frame(frame: Any) -> list[dict[str, Any]]:
    """Normalize JQData bars while preserving invalid fields for quality audit."""

    rows: list[dict[str, Any]] = []
    for raw in frame_records(frame):
        timestamp = None
        for key in ("date", "datetime", "time", "index"):
            timestamp = _timestamp(raw.get(key))
            if timestamp is not None:
                break
        if timestamp is None:
            # A malformed timestamp is preserved as an invalid row so a 240-row
            # provider response cannot become falsely valid after normalization.
            rows.append({
                "timestamp": None,
                "open": finite_number(raw.get("open")),
                "high": finite_number(raw.get("high")),
                "low": finite_number(raw.get("low")),
                "close": finite_number(raw.get("close")),
                "volume": finite_number(raw.get("volume")),
                "money": finite_number(raw.get("money")),
            })
            continue
        rows.append({
            "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "open": finite_number(raw.get("open")),
            "high": finite_number(raw.get("high")),
            "low": finite_number(raw.get("low")),
            "close": finite_number(raw.get("close")),
            "volume": finite_number(raw.get("volume")),
            "money": finite_number(raw.get("money")),
        })
    return rows


def validate_bars(bars: Sequence[dict[str, Any]], trading_date: str) -> dict[str, Any]:
    expected = expected_minute_timestamps(trading_date)
    expected_set = set(expected)
    timestamps = [bar.get("timestamp") for bar in bars]
    valid_timestamps = [value for value in timestamps if isinstance(value, str)]
    actual_set = set(valid_timestamps)
    duplicate_count = len(valid_timestamps) - len(actual_set)
    missing = sorted(expected_set - actual_set)
    extra = sorted(actual_set - expected_set)
    exact_order = valid_timestamps == expected and len(valid_timestamps) == len(timestamps)

    fields_complete = True
    ohlc_consistent = True
    volume_money_non_negative = True
    total_volume = 0.0
    total_money = 0.0
    for bar in bars:
        open_price, high, low, close = (
            finite_number(bar.get(field)) for field in ("open", "high", "low", "close")
        )
        volume = finite_number(bar.get("volume"))
        money = finite_number(bar.get("money"))
        if any(value is None for value in (open_price, high, low, close, volume, money)):
            fields_complete = False
            continue
        assert open_price is not None and high is not None and low is not None and close is not None
        assert volume is not None and money is not None
        if min(open_price, high, low, close) <= 0:
            fields_complete = False
        if high < max(open_price, close) or low > min(open_price, close) or high < low:
            ohlc_consistent = False
        if volume < 0 or money < 0:
            volume_money_non_negative = False
        else:
            total_volume += volume
            total_money += money

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
        blockers.append("ohlcv_money_incomplete_or_non_positive_price")
    if not ohlc_consistent:
        blockers.append("ohlc_internally_inconsistent")
    if not volume_money_non_negative:
        blockers.append("negative_volume_or_money")
    if total_volume <= 0:
        blockers.append("daily_volume_not_positive")
    if total_money <= 0:
        blockers.append("daily_money_not_positive")

    return {
        "expectedBarCount": EXPECTED_BAR_COUNT,
        "actualBarCount": len(bars),
        "firstTimestamp": valid_timestamps[0] if valid_timestamps else None,
        "lastTimestamp": valid_timestamps[-1] if valid_timestamps else None,
        "exactTradingSchedule": not missing and not extra and not duplicate_count and exact_order,
        "timestampsOrdered": exact_order,
        "duplicateTimestampCount": duplicate_count,
        "missingTimestampCount": len(missing),
        "extraTimestampCount": len(extra),
        "missingTimestamps": missing,
        "extraTimestamps": extra,
        "ohlcvMoneyComplete": fields_complete,
        "ohlcInternallyConsistent": ohlc_consistent,
        "volumeMoneyNonNegative": volume_money_non_negative,
        "totalVolume": total_volume,
        "totalMoney": total_money,
        "dailyVolumePositive": total_volume > 0,
        "dailyMoneyPositive": total_money > 0,
        "blockers": blockers,
        "passed": not blockers,
    }


def fetch_requirement(jq: Any, requirement: Requirement, provider_version: str) -> dict[str, Any]:
    """Fetch one pair. Any provider exception becomes an unavailable record."""

    base = {
        "provider": PROVIDER_NAME,
        "providerVersion": provider_version,
        "barIntervalMinutes": 1,
        "priceMode": "raw_unadjusted",
        "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
        "code": six_digit_code(requirement.code),
        "jqCode": requirement.jq_code,
        "tradingDate": requirement.trading_date,
        "validForExecutionReplay": False,
        "validForV7": False,
        "executionAuthority": False,
    }
    try:
        frame = jq.get_bars(
            requirement.jq_code,
            unit="1m",
            fields=("date", "open", "high", "low", "close", "volume", "money"),
            include_now=True,
            start_dt=f"{requirement.trading_date} 09:30:00",
            end_dt=f"{requirement.trading_date} 15:00:00",
            fq_ref_date=None,
            df=True,
            skip_paused=False,
        )
    except Exception as error:  # provider and permission failures are audit state
        return {
            **base,
            "status": "provider_error",
            "bars": [],
            "contentHash": None,
            "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
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

    bars = normalize_frame(frame)
    quality = validate_bars(bars, requirement.trading_date)
    content_hash = minute_content_hash(bars)
    return {
        **base,
        "status": "valid" if quality["passed"] else "data_quality_failed",
        "validForExecutionReplay": bool(quality["passed"]),
        "validForV7": bool(quality["passed"]),
        "bars": bars,
        "contentHash": content_hash,
        "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
        "scheduleQuality": quality,
        "error": None,
    }


def build_output(jq: Any, requirements: Sequence[Requirement]) -> dict[str, Any]:
    provider_version = str(getattr(jq, "__version__", "unknown") or "unknown")
    records = [fetch_requirement(jq, requirement, provider_version) for requirement in requirements]
    valid_count = sum(record["validForExecutionReplay"] is True for record in records)
    provider_errors = sum(record["status"] == "provider_error" for record in records)
    invalid_count = len(records) - valid_count
    return {
        "schemaVersion": 1,
        "authority": AUTHORITY,
        "executionAuthority": False,
        "generatedAt": datetime.now(SHANGHAI_TZ).isoformat(),
        "provider": {
            "name": PROVIDER_NAME,
            "sdk": "jqdatasdk",
            "version": provider_version,
        },
        "barIntervalMinutes": 1,
        "priceMode": "raw_unadjusted",
        "contentHashScope": CANONICAL_MINUTE_HASH_SCOPE,
        "credentialsPersisted": False,
        "rules": {
            "pairScope": "exact_validation_or_explicit_code_date_only",
            "expectedDailyBarCount": EXPECTED_BAR_COUNT,
            "sessionTimestamps": "09:31-11:30,13:01-15:00 Asia/Shanghai",
            "providerAdjustmentArgument": "fq_ref_date=None",
            "missingOrInvalidPolicy": "unavailable_no_synthetic_fill",
        },
        "requirements": [requirement.as_json() for requirement in requirements],
        "records": records,
        "qualitySummary": {
            "requestedPairCount": len(records),
            "validPairCount": valid_count,
            "invalidPairCount": invalid_count,
            "providerErrorCount": provider_errors,
            "coveragePct": round(valid_count / len(records) * 100, 4) if records else 0,
            "allRequestedPairsValid": bool(records and invalid_count == 0),
            "formalTradingAuthority": False,
        },
    }


def acquire_credentials() -> tuple[str, str]:
    """Acquire credentials without accepting command-line or file secrets."""

    username = os.environ.get("JQDATA_USER", "").strip()
    password = os.environ.get("JQDATA_PASSWORD", "")
    if username and password:
        # Remove process copies immediately after reading. This cannot alter the
        # parent environment but prevents accidental child-process inheritance.
        os.environ.pop("JQDATA_USER", None)
        os.environ.pop("JQDATA_PASSWORD", None)
        return username, password

    try:
        import tkinter as tk
        from tkinter import messagebox, simpledialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        username = simpledialog.askstring("JQData一分钟验证抓取", "聚宽/JQData账号：", parent=root) or ""
        password = simpledialog.askstring(
            "JQData一分钟验证抓取",
            "密码（仅当前进程使用，不会保存）：",
            show="*",
            parent=root,
        ) or ""
        if not username.strip() or not password:
            messagebox.showwarning("抓取已取消", "未输入完整凭证。", parent=root)
        root.destroy()
        return username.strip(), password
    except Exception:
        if not sys.stdin.isatty():
            return "", ""
        username = input("JQData username: ").strip()
        password = getpass.getpass("JQData password (hidden, not persisted): ")
        return username, password


def load_jqdata() -> Any:
    try:
        import jqdatasdk as jq  # pylint: disable=import-outside-toplevel
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "jqdatasdk is required; install requirements-jqdata.txt in an isolated environment"
        ) from error
    return jq


def authenticate(jq: Any, username: str, password: str) -> None:
    if not username or not password:
        raise CredentialError("credentials_not_provided")
    try:
        jq.auth(username, password)
        if hasattr(jq, "is_auth") and jq.is_auth() is not True:
            raise CredentialError("authentication_not_confirmed")
    except CredentialError:
        raise
    except Exception as error:
        raise CredentialError("authentication_failed") from error


def resolve_output_path(value: str | Path) -> Path:
    target = Path(value).expanduser()
    if not target.is_absolute():
        target = ROOT / target
    target = target.resolve()
    try:
        target.relative_to(DATA_DIR.resolve())
    except ValueError as error:
        raise InputContractError("output must remain below the repository data directory") from error
    return target


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch exact validation-only JQData raw 1-minute stock/date pairs."
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
    parser.add_argument("--limit", type=int, default=0, help="optional positive cap for validation pairs")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    return parser.parse_args(argv)


def requested_requirements(args: argparse.Namespace) -> list[Requirement]:
    if args.limit < 0:
        raise InputContractError("limit cannot be negative")
    if args.pair:
        requirements = [parse_explicit_pair(value) for value in args.pair]
    else:
        requirements_path = Path(args.requirements_report).expanduser()
        if not requirements_path.is_absolute():
            requirements_path = ROOT / requirements_path
        requirements = load_validation_requirements(requirements_path.resolve())
    requirements = deduplicate_requirements(requirements)
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
        jq = load_jqdata()
        username, password = acquire_credentials()
        authenticate(jq, username, password)
        output = build_output(jq, requirements)
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
    except CredentialError as error:
        print(json.dumps({"ok": False, "reason": str(error)}, ensure_ascii=False))
        return 3
    except RuntimeError as error:
        print(json.dumps({"ok": False, "reason": "runtime_dependency_error", "error": str(error)}, ensure_ascii=False))
        return 5
    finally:
        # Local reassignment is best-effort; no credentials are ever serialized.
        if "password" in locals():
            password = ""
        if "username" in locals():
            username = ""


if __name__ == "__main__":
    raise SystemExit(main())
