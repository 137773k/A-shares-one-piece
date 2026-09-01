"""Offline contract tests for the JQData one-minute validation fetcher."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import pandas as pd

from fetch_jqdata_minute_outcomes import (
    EXPECTED_BAR_COUNT,
    CANONICAL_MINUTE_HASH_SCOPE,
    Requirement,
    build_output,
    canonical_json_hash,
    deduplicate_requirements,
    expected_minute_timestamps,
    fetch_requirement,
    load_validation_requirements,
    minute_content_hash,
    normalize_frame,
    normalize_jq_code,
    parse_explicit_pair,
    resolve_output_path,
    validate_bars,
)


def valid_frame(trading_date: str = "2026-05-22") -> pd.DataFrame:
    rows = []
    for index, timestamp in enumerate(expected_minute_timestamps(trading_date)):
        base = 10 + index / 10_000
        rows.append({
            "date": datetime.fromisoformat(timestamp),
            "open": base,
            "high": base + 0.02,
            "low": base - 0.02,
            "close": base + 0.01,
            "volume": 1000 + index,
            "money": (1000 + index) * base,
        })
    return pd.DataFrame(rows)


class FakeJQData:
    __version__ = "test-1.0"

    def __init__(self, frame=None, error: Exception | None = None):
        self.frame = valid_frame() if frame is None else frame
        self.error = error
        self.calls = []

    def get_bars(self, code, **kwargs):
        self.calls.append((code, kwargs))
        if self.error is not None:
            raise self.error
        return self.frame.copy()


class JQDataMinuteOutcomeContractTest(unittest.TestCase):
    def test_exchange_normalization_and_explicit_pair(self):
        self.assertEqual(normalize_jq_code("600000"), "600000.XSHG")
        self.assertEqual(normalize_jq_code("000001"), "000001.XSHE")
        with self.assertRaisesRegex(ValueError, "BSE requests fail closed"):
            normalize_jq_code("830799")
        with self.assertRaisesRegex(ValueError, "BSE requests fail closed"):
            normalize_jq_code("830799.XBEI")
        with self.assertRaisesRegex(ValueError, "BSE requests fail closed"):
            normalize_jq_code("830799.XBSE")
        with self.assertRaisesRegex(ValueError, "BSE requests fail closed"):
            deduplicate_requirements([Requirement("830799", "2026-05-22")])
        with self.assertRaisesRegex(ValueError, "exchange suffix are inconsistent"):
            normalize_jq_code("000001.XSHG")
        pair = parse_explicit_pair("000001@2026-05-22")
        self.assertEqual(pair.jq_code, "000001.XSHE")
        self.assertEqual(pair.trading_date, "2026-05-22")

    def test_exact_240_bar_schedule_and_content_hash_are_deterministic(self):
        bars = normalize_frame(valid_frame())
        quality = validate_bars(bars, "2026-05-22")
        self.assertEqual(len(bars), EXPECTED_BAR_COUNT)
        self.assertTrue(quality["passed"])
        self.assertTrue(quality["exactTradingSchedule"])
        self.assertEqual(quality["firstTimestamp"], "2026-05-22 09:31:00")
        self.assertEqual(quality["lastTimestamp"], "2026-05-22 15:00:00")
        self.assertEqual(canonical_json_hash(bars), canonical_json_hash(normalize_frame(valid_frame())))

    def test_missing_minute_and_bad_ohlcv_fail_closed(self):
        frame = valid_frame().drop(index=[17]).reset_index(drop=True)
        frame.loc[0, "high"] = frame.loc[0, "low"] - 1
        frame.loc[1, "volume"] = -1
        bars = normalize_frame(frame)
        quality = validate_bars(bars, "2026-05-22")
        self.assertFalse(quality["passed"])
        self.assertIn("unexpected_1m_bar_count", quality["blockers"])
        self.assertIn("minute_schedule_missing", quality["blockers"])
        self.assertIn("ohlc_internally_inconsistent", quality["blockers"])
        self.assertIn("negative_volume_or_money", quality["blockers"])

    def test_missing_money_or_zero_daily_turnover_fails_closed(self):
        missing_money = valid_frame()
        missing_money.loc[0, "money"] = None
        missing_quality = validate_bars(normalize_frame(missing_money), "2026-05-22")
        self.assertFalse(missing_quality["passed"])
        self.assertIn("ohlcv_money_incomplete_or_non_positive_price", missing_quality["blockers"])

        no_turnover = valid_frame()
        no_turnover["volume"] = 0
        no_turnover["money"] = 0
        zero_quality = validate_bars(normalize_frame(no_turnover), "2026-05-22")
        self.assertFalse(zero_quality["passed"])
        self.assertIn("daily_volume_not_positive", zero_quality["blockers"])
        self.assertIn("daily_money_not_positive", zero_quality["blockers"])
        self.assertEqual(zero_quality["totalVolume"], 0)
        self.assertEqual(zero_quality["totalMoney"], 0)

    def test_fetch_uses_raw_unadjusted_one_minute_arguments(self):
        provider = FakeJQData()
        requirement = Requirement("000001", "2026-05-22")
        record = fetch_requirement(provider, requirement, provider.__version__)
        self.assertTrue(record["validForExecutionReplay"])
        self.assertEqual(record["barIntervalMinutes"], 1)
        self.assertEqual(record["provider"], "JQData")
        self.assertEqual(record["providerVersion"], "test-1.0")
        self.assertEqual(record["scheduleQuality"]["actualBarCount"], 240)
        self.assertRegex(record["contentHash"], r"^[a-f0-9]{64}$")
        self.assertEqual(record["contentHashScope"], CANONICAL_MINUTE_HASH_SCOPE)
        self.assertEqual(record["contentHash"], minute_content_hash(record["bars"]))
        _, kwargs = provider.calls[0]
        self.assertEqual(kwargs["unit"], "1m")
        self.assertIsNone(kwargs["fq_ref_date"])
        self.assertFalse(kwargs["skip_paused"])
        self.assertEqual(kwargs["fields"], ("date", "open", "high", "low", "close", "volume", "money"))

    def test_provider_or_permission_error_never_produces_valid_data(self):
        provider = FakeJQData(error=PermissionError("paid module"))
        requirement = Requirement("000001", "2026-05-22")
        record = fetch_requirement(provider, requirement, provider.__version__)
        self.assertEqual(record["status"], "provider_error")
        self.assertFalse(record["validForExecutionReplay"])
        self.assertFalse(record["executionAuthority"])
        self.assertEqual(record["bars"], [])
        self.assertIsNone(record["contentHash"])
        self.assertNotIn("paid module", str(record))

    def test_output_keeps_validation_and_trading_authority_separate(self):
        output = build_output(FakeJQData(), [Requirement("000001", "2026-05-22")])
        self.assertEqual(output["provider"]["version"], "test-1.0")
        self.assertEqual(output["barIntervalMinutes"], 1)
        self.assertEqual(output["qualitySummary"]["validPairCount"], 1)
        self.assertTrue(output["qualitySummary"]["allRequestedPairsValid"])
        self.assertFalse(output["qualitySummary"]["formalTradingAuthority"])
        self.assertFalse(output["executionAuthority"])
        serialized = str(output)
        self.assertNotIn("username", serialized.lower())
        self.assertNotIn("password", serialized.lower())

    def test_validation_report_loads_only_exact_unified_order_pairs(self):
        payload = {
            "rankingStudy": {
                "days": [{
                    "tradingDate": "2026-05-21",
                    "nextDate": "2026-05-22",
                    "unifiedOrder": [{"code": "000001"}, {"code": "600000"}],
                    "outcomes": [{"code": "300001"}],
                }]
            }
        }
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "requirements.json"
            path.write_text(__import__("json").dumps(payload), encoding="utf-8")
            requirements = load_validation_requirements(path)
        self.assertEqual([(row.code, row.trading_date) for row in requirements], [
            ("000001", "2026-05-22"),
            ("600000", "2026-05-22"),
        ])

    def test_output_is_restricted_to_ignored_data_directory(self):
        accepted = resolve_output_path("data/test/jqdata.json")
        self.assertIn("data", accepted.parts)
        with self.assertRaisesRegex(ValueError, "below the repository data directory"):
            resolve_output_path("jqdata-secrets.json")


if __name__ == "__main__":
    unittest.main()
