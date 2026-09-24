import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts.run_fx_gold_walkforward import (
    clean_ohlc,
    eligibility_block,
    fee_from_costs,
    make_folds,
    metric_block,
    quality_assessment,
    research_safety,
)


class FxGoldWalkForwardTests(unittest.TestCase):
    def test_fee_model_is_per_side_decimal(self):
        costs = {
            "spread_bps": 0.8,
            "slippage_bps": 0.2,
            "commission_bps": 0.0,
        }
        self.assertAlmostEqual(fee_from_costs(costs, 1.0), 0.0001)
        self.assertAlmostEqual(fee_from_costs(costs, 2.0), 0.0002)

    def test_folds_have_no_is_oos_overlap(self):
        folds = make_folds(
            1000,
            {
                "train_bars": 300,
                "test_bars": 100,
                "step_bars": 100,
                "anchored": False,
            },
        )
        self.assertGreater(len(folds), 0)

        for fold in folds:
            self.assertLessEqual(fold.is_end, fold.oos_start)
            self.assertLess(fold.oos_start, fold.oos_end)

    def test_clean_ohlc_sorts_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "test.csv"

            pd.DataFrame([
                {
                    "time": "2026-01-01T01:00:00Z",
                    "open": 2,
                    "high": 3,
                    "low": 1,
                    "close": 2,
                    "volume": 0,
                },
                {
                    "time": "2026-01-01T00:00:00Z",
                    "open": 1,
                    "high": 2,
                    "low": 0.5,
                    "close": 1.5,
                    "volume": 0,
                },
                {
                    "time": "2026-01-01T01:00:00Z",
                    "open": 2,
                    "high": 3,
                    "low": 1,
                    "close": 2.5,
                    "volume": 0,
                },
            ]).to_csv(path, index=False)

            cleaned, warnings, quality = clean_ohlc(path, "1h")

            self.assertEqual(len(cleaned), 2)
            self.assertTrue(cleaned["time"].is_monotonic_increasing)
            self.assertGreaterEqual(len(warnings), 1)
            self.assertFalse(quality["passed"])
            self.assertIn("DUPLICATE_TIMESTAMPS", quality["reasonCodes"])

    def test_metrics_have_long_short_breakdown(self):
        trades = [
            {"entry_price": 100, "exit_price": 110, "direction": 1},
            {"entry_price": 100, "exit_price": 90, "direction": -1},
        ]

        metrics = metric_block(
            trades,
            fee=0.0,
            initial_equity=1000.0,
            timeframe="1day",
        )

        self.assertEqual(metrics["total_trades"], 2)
        self.assertEqual(metrics["long"]["trades"], 1)
        self.assertEqual(metrics["short"]["trades"], 1)
        self.assertIsNotNone(metrics["total_return_pct"])

    def test_null_metrics_for_no_trades(self):
        metrics = metric_block(
            [],
            fee=0.0,
            initial_equity=1000.0,
            timeframe="1h",
        )

        self.assertIsNone(metrics["total_trades"])
        self.assertIsNone(metrics["profit_factor"])

    def test_four_hour_metric_block_is_supported(self):
        trades = [
            {"entry_price": 100, "exit_price": 105, "direction": 1},
            {"entry_price": 100, "exit_price": 102, "direction": -1},
        ]

        metrics = metric_block(
            trades,
            fee=0.0,
            initial_equity=1000.0,
            timeframe="4h",
        )

        self.assertEqual(metrics["total_trades"], 2)
        self.assertIsNotNone(metrics["sharpe_ratio"])

    def test_data_quality_failure_forces_insufficient_data(self):
        quality = quality_assessment(
            source_rows=10,
            usable_rows=9,
            invalid_rows=1,
            duplicate_rows=0,
            large_gap_count=0,
            timeframe="1h",
        )

        result = eligibility_block(
            quality=quality,
            candidate_folds=12,
            valid_completed_folds=12,
            warmup_pass=True,
            closed_oos_trades=50,
            minimum_folds=8,
            minimum_trades=30,
        )

        self.assertFalse(result["eligible"])
        self.assertEqual(result["status"], "INSUFFICIENT_DATA")
        self.assertIn("DATA_QUALITY_FAILED", result["reasonCodes"])

    def test_missing_warmup_forces_insufficient_data(self):
        quality = quality_assessment(
            source_rows=100,
            usable_rows=100,
            invalid_rows=0,
            duplicate_rows=0,
            large_gap_count=0,
            timeframe="4h",
        )

        result = eligibility_block(
            quality=quality,
            candidate_folds=10,
            valid_completed_folds=10,
            warmup_pass=False,
            closed_oos_trades=50,
            minimum_folds=8,
            minimum_trades=30,
        )

        self.assertFalse(result["eligible"])
        self.assertEqual(result["status"], "INSUFFICIENT_DATA")
        self.assertIn("INSUFFICIENT_WARMUP", result["reasonCodes"])

    def test_fewer_than_eight_valid_folds_forces_insufficient_data(self):
        quality = quality_assessment(
            source_rows=100,
            usable_rows=100,
            invalid_rows=0,
            duplicate_rows=0,
            large_gap_count=0,
            timeframe="1day",
        )

        result = eligibility_block(
            quality=quality,
            candidate_folds=10,
            valid_completed_folds=7,
            warmup_pass=True,
            closed_oos_trades=50,
            minimum_folds=8,
            minimum_trades=30,
        )

        self.assertFalse(result["eligible"])
        self.assertEqual(result["status"], "INSUFFICIENT_DATA")
        self.assertIn("INSUFFICIENT_FOLDS", result["reasonCodes"])

    def test_fewer_than_thirty_trades_forces_insufficient_data(self):
        quality = quality_assessment(
            source_rows=100,
            usable_rows=100,
            invalid_rows=0,
            duplicate_rows=0,
            large_gap_count=0,
            timeframe="1h",
        )

        result = eligibility_block(
            quality=quality,
            candidate_folds=10,
            valid_completed_folds=10,
            warmup_pass=True,
            closed_oos_trades=29,
            minimum_folds=8,
            minimum_trades=30,
        )

        self.assertFalse(result["eligible"])
        self.assertEqual(result["status"], "INSUFFICIENT_DATA")
        self.assertIn("INSUFFICIENT_TRADES", result["reasonCodes"])

    def test_all_gates_make_metrics_eligible(self):
        quality = quality_assessment(
            source_rows=100,
            usable_rows=100,
            invalid_rows=0,
            duplicate_rows=0,
            large_gap_count=0,
            timeframe="1h",
        )

        result = eligibility_block(
            quality=quality,
            candidate_folds=8,
            valid_completed_folds=8,
            warmup_pass=True,
            closed_oos_trades=30,
            minimum_folds=8,
            minimum_trades=30,
        )

        self.assertTrue(result["eligible"])
        self.assertEqual(result["status"], "OOS_METRICS_AVAILABLE")
        self.assertEqual(result["reasonCodes"], [])

    def test_research_safety_contract_is_execution_disabled(self):
        value = research_safety()

        self.assertTrue(value["researchOnly"])
        self.assertFalse(value["approvedForTrading"])
        self.assertFalse(value["brokerConnectivityAllowed"])
        self.assertFalse(value["websocketAllowed"])
        self.assertFalse(value["ordersAllowed"])
        self.assertFalse(value["executionAllowed"])
        self.assertTrue(value["humanReviewRequired"])


if __name__ == "__main__":
    unittest.main()
