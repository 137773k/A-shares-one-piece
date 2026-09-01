"""Offline contract tests for the free AKShare/Sina Tier-2 one-minute archive."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import pandas as pd

from fetch_akshare_1m_outcomes import (
    AUTHORITY,
    CANONICAL_MINUTE_HASH_SCOPE,
    EXPECTED_BAR_COUNT,
    SOURCE,
    Requirement,
    build_output,
    expected_minute_timestamps,
    minute_content_hash,
    normalize_frame,
    record_from_rows,
    requested_requirements,
    resolve_output_path,
    sina_symbol,
    validate_bars,
)


ROOT = Path(__file__).resolve().parent
DATE = "2026-08-24"


def valid_frame(trading_date: str = DATE) -> pd.DataFrame:
    rows = []
    for index, timestamp in enumerate(expected_minute_timestamps(trading_date)):
        base = 10 + index / 10_000
        volume = 1000 + index
        rows.append({
            "day": datetime.fromisoformat(timestamp),
            "open": base,
            "high": base + 0.02,
            "low": base - 0.02,
            "close": base + 0.01,
            "volume": volume,
            "amount": volume * (base + 0.005),
        })
    return pd.DataFrame(rows)


class FakeAKShare:
    __version__ = "test-akshare-1.0"

    def __init__(self, frame=None, error: Exception | None = None):
        self.frame = valid_frame() if frame is None else frame
        self.error = error
        self.calls: list[dict[str, str]] = []

    def stock_zh_a_minute(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.frame.copy()


class AKShareOneMinuteOutcomeContractTest(unittest.TestCase):
    def test_sina_symbols_are_exact_exchange_prefixed_codes(self):
        self.assertEqual(sina_symbol("000001"), "sz000001")
        self.assertEqual(sina_symbol("600000"), "sh600000")
        self.assertEqual(sina_symbol("830799"), "bj830799")

        arguments = type("Args", (), {
            "limit": 0,
            "pair": ["830799@2026-08-24"],
            "requirements_report": "",
        })()
        self.assertEqual(requested_requirements(arguments)[0].code, "830799")

    def test_exact_schedule_ohlcv_amount_and_positive_daily_trading(self):
        bars = normalize_frame(valid_frame())
        quality = validate_bars(bars, DATE)
        self.assertEqual(len(bars), EXPECTED_BAR_COUNT)
        self.assertTrue(quality["passed"])
        self.assertTrue(quality["exactTradingSchedule"])
        self.assertTrue(quality["ohlcvAmountComplete"])
        self.assertTrue(quality["positiveDailyTrading"])
        self.assertEqual(quality["firstTimestamp"], f"{DATE} 09:31:00")
        self.assertEqual(quality["lastTimestamp"], f"{DATE} 15:00:00")

    def test_canonical_hash_matches_javascript_minute_evidence(self):
        bars = normalize_frame(valid_frame())
        node = subprocess.run(
            [
                "node",
                "-e",
                "const fs=require('node:fs');"
                "const {computeMinuteContentHash}=require('./quant-decision/minute-evidence');"
                "const rows=JSON.parse(fs.readFileSync(0,'utf8'));"
                "process.stdout.write(computeMinuteContentHash(rows));",
            ],
            cwd=ROOT,
            input=json.dumps(bars, ensure_ascii=False, separators=(",", ":")),
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(minute_content_hash(bars), node.stdout.strip())

    def test_missing_fields_bad_ohlc_and_zero_day_fail_closed(self):
        frame = valid_frame().drop(index=[17]).reset_index(drop=True)
        frame.loc[0, "high"] = frame.loc[0, "low"] - 1
        frame.loc[1, "amount"] = None
        frame.loc[:, "volume"] = 0
        frame.loc[:, "amount"] = 0
        frame.loc[1, "amount"] = None
        quality = validate_bars(normalize_frame(frame), DATE)
        self.assertFalse(quality["passed"])
        self.assertIn("unexpected_1m_bar_count", quality["blockers"])
        self.assertIn("minute_schedule_missing", quality["blockers"])
        self.assertIn("ohlcv_amount_incomplete_or_non_positive_price", quality["blockers"])
        self.assertIn("ohlc_internally_inconsistent", quality["blockers"])
        self.assertIn("daily_trading_volume_or_amount_not_positive", quality["blockers"])

    def test_provider_call_is_sina_raw_one_minute_and_output_is_tier2(self):
        provider = FakeAKShare()
        output = build_output(provider, [Requirement("000001", DATE)])
        self.assertEqual(provider.calls, [{"symbol": "sz000001", "period": "1", "adjust": ""}])
        record = output["records"][0]
        self.assertEqual(output["authority"], AUTHORITY)
        self.assertEqual(output["source"], SOURCE)
        self.assertEqual(record["provider"], "AKShare")
        self.assertEqual(record["source"], SOURCE)
        self.assertEqual(record["barIntervalMinutes"], 1)
        self.assertEqual(record["priceMode"], "raw_unadjusted")
        self.assertEqual(record["contentHashScope"], CANONICAL_MINUTE_HASH_SCOPE)
        self.assertRegex(record["contentHash"], r"^[a-f0-9]{64}$")
        self.assertTrue(record["validForV7"])
        self.assertFalse(record["executionAuthority"])
        self.assertFalse(output["executionAuthority"])
        self.assertFalse(output["qualitySummary"]["formalTradingAuthority"])

    def test_output_is_selected_by_javascript_only_as_tier2(self):
        output = build_output(FakeAKShare(), [Requirement("000001", DATE)])
        node = subprocess.run(
            [
                "node",
                "-e",
                "const fs=require('node:fs');"
                "const {selectV7MinuteEvidenceFromCaches}=require('./quant-decision/outcome-evidence');"
                "const cache=JSON.parse(fs.readFileSync(0,'utf8'));"
                "const result=selectV7MinuteEvidenceFromCaches({code:'000001',tradingDate:'2026-08-24',caches:[cache]});"
                "process.stdout.write(JSON.stringify({status:result.status,tier:result.selectedPriceEvidence&&result.selectedPriceEvidence.tier,classification:result.selectedPriceEvidence&&result.selectedPriceEvidence.classification,executionAuthority:result.executionAuthority}));",
            ],
            cwd=ROOT,
            input=json.dumps(output, ensure_ascii=False, separators=(",", ":")),
            text=True,
            capture_output=True,
            check=True,
        )
        selected = json.loads(node.stdout)
        self.assertEqual(selected["status"], "price_ready_seal_evidence_missing")
        self.assertEqual(selected["tier"], 2)
        self.assertEqual(selected["classification"], "akshare_verified_raw_1m")
        self.assertFalse(selected["executionAuthority"])

    def test_requested_date_outside_free_window_never_uses_nearest_date(self):
        rows = normalize_frame(valid_frame("2026-08-22"))
        record = record_from_rows(Requirement("000001", DATE), "test", rows)
        self.assertEqual(record["status"], "date_outside_free_window_or_not_returned")
        self.assertFalse(record["validForV7"])
        self.assertEqual(record["bars"], [])
        self.assertIsNone(record["contentHash"])
        self.assertIn("requested_date_not_in_provider_free_window", record["scheduleQuality"]["blockers"])

    def test_provider_or_permission_error_is_sanitized_and_fails_closed(self):
        output = build_output(
            FakeAKShare(error=PermissionError("provider secret response")),
            [Requirement("000001", DATE)],
        )
        record = output["records"][0]
        self.assertEqual(record["status"], "provider_or_permission_error")
        self.assertFalse(record["validForV7"])
        self.assertFalse(record["executionAuthority"])
        self.assertEqual(record["bars"], [])
        self.assertNotIn("provider secret response", str(record))

    def test_output_is_restricted_to_ignored_data_directory(self):
        accepted = resolve_output_path("data/test/akshare-sina-1m.json")
        self.assertIn("data", accepted.parts)
        with self.assertRaisesRegex(ValueError, "below the repository data directory"):
            resolve_output_path("akshare-sina-1m.json")

    def test_exact_validation_report_pairs_can_be_loaded_without_network(self):
        payload = {
            "rankingStudy": {
                "days": [{
                    "tradingDate": "2026-08-21",
                    "nextDate": DATE,
                    "unifiedOrder": [{"code": "000001"}, {"code": "600000"}],
                    "outcomes": [{"code": "300001"}],
                }]
            }
        }
        from fetch_akshare_1m_outcomes import load_validation_requirements

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "requirements.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            rows = load_validation_requirements(path)
        self.assertEqual([(row.code, row.trading_date) for row in rows], [
            ("000001", DATE),
            ("600000", DATE),
        ])


if __name__ == "__main__":
    unittest.main()
