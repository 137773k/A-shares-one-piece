"""Offline contract tests for AKShare minute backfill normalization."""

import unittest

import pandas as pd

from fetch_akshare_minute_outcomes import normalize_frame, resolve_daily_reference, select_pilot, validate_day


class MinuteOutcomeContractTest(unittest.TestCase):
    def test_normalize_sina_and_eastmoney_columns(self):
        sina = pd.DataFrame([{
            "day": "2026-08-21 09:35:00",
            "open": 10,
            "high": 10.2,
            "low": 9.9,
            "close": 10.1,
            "volume": 100,
            "amount": 1000,
        }])
        east = pd.DataFrame([{
            "时间": "2026-08-21 09:35:00",
            "开盘": 10,
            "最高": 10.2,
            "最低": 9.9,
            "收盘": 10.1,
            "成交量": 1,
            "成交额": 1000,
        }])
        self.assertEqual(normalize_frame(sina, "sina")[0]["time"], "09:35")
        self.assertEqual(normalize_frame(east, "east")[0]["amount"], 1000)

    def test_valid_day_requires_raw_daily_reference_and_consistent_ohlc(self):
        bars = []
        for index in range(48):
            hour = 9 + (35 + index * 5) // 60
            minute = (35 + index * 5) % 60
            if hour >= 12:
                hour += 1
            bars.append({
                "date": "2026-08-21",
                "time": f"{hour:02d}:{minute:02d}",
                "open": 10 if index == 0 else 10.1,
                "high": 10.5 if index == 20 else 10.2,
                "low": 9.8 if index == 10 else 10,
                "close": 10.3 if index == 47 else 10.1,
                "volume": 100,
                "amount": 1000,
                "source": "fixture",
            })
        reference = {
            "source": "raw_closing_candidate_snapshot",
            "open": 10,
            "high": 10.5,
            "low": 9.8,
            "close": 10.3,
            "amount": 48000,
        }
        result = validate_day(bars, reference)
        self.assertTrue(result["passed"])
        fallback = validate_day(bars, {**reference, "source": "tencent_qfq_daily_kline_fallback"})
        self.assertFalse(fallback["passed"])
        self.assertIn("raw_daily_reference_missing_or_unverified_price_bridge", fallback["blockers"])

    def test_qfq_reference_requires_exact_t_to_t1_price_bridge(self):
        qfq = {("000001", "2026-08-21"): {
            "source": "tencent_qfq_daily_kline_fallback",
            "open": 10,
            "high": 11,
            "low": 9,
            "close": 10.5,
            "amount": 1000,
        }}
        rejected = resolve_daily_reference("000001", "2026-08-21", {"priceBridgeValid": False}, {}, qfq)
        accepted = resolve_daily_reference("000001", "2026-08-21", {
            "priceBridgeValid": True,
            "priceDifferencePct": 0.01,
        }, {}, qfq)
        self.assertFalse(rejected["priceBridgeValid"])
        self.assertTrue(accepted["priceBridgeValid"])

    def test_pilot_uses_most_frequent_real_requirements(self):
        rows = [
            {"code": "A", "nextDate": f"2026-08-{day:02d}"} for day in (1, 2, 3)
        ] + [
            {"code": "B", "nextDate": f"2026-08-{day:02d}"} for day in (1, 2)
        ] + [{"code": "C", "nextDate": "2026-08-01"}]
        selected = select_pilot(rows)
        self.assertEqual([row["code"] for row in selected], ["A", "A", "A", "B", "B", "C"])


if __name__ == "__main__":
    unittest.main()
