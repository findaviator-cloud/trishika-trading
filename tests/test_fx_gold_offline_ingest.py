import csv
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "fx_gold_offline_ingest.py"

spec = importlib.util.spec_from_file_location("fx_gold_offline_ingest", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)


class OfflineIngestionTests(unittest.TestCase):
    def test_asset_and_provider_validation(self):
        self.assertEqual(module.canonical_asset("eur/usd"), "EURUSD")
        self.assertEqual(module.canonical_asset("xau_usd"), "XAUUSD")
        self.assertEqual(module.canonical_provider("histdata"), "HISTDATA")
        self.assertEqual(module.canonical_provider("dukascopy"), "DUKASCOPY")
        with self.assertRaises(ValueError):
            module.canonical_asset("BTCUSD")

    def test_utc_aggregation(self):
        rows = [
            {"time": module.parse_timestamp("2025-01-01T00:01:00Z"), "open": 1.0, "high": 1.2, "low": 0.9, "close": 1.1, "volume": 2},
            {"time": module.parse_timestamp("2025-01-01T00:59:00Z"), "open": 1.1, "high": 1.3, "low": 1.0, "close": 1.2, "volume": 3},
            {"time": module.parse_timestamp("2025-01-01T01:00:00Z"), "open": 1.2, "high": 1.4, "low": 1.1, "close": 1.3, "volume": 4},
        ]
        bars = module.aggregate(rows, "1h")
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]["open"], 1.0)
        self.assertEqual(bars[0]["close"], 1.2)
        self.assertEqual(bars[0]["sourceM1Rows"], 2)

    def test_cli_writes_isolated_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            temp = Path(tmp)
            raw = temp / "sample.csv"
            with raw.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["time", "open", "high", "low", "close", "volume"])
                writer.writerow(["2025-01-01T00:00:00Z", "1", "1.1", "0.9", "1.05", "1"])
                writer.writerow(["2025-01-01T00:01:00Z", "1.05", "1.2", "1.0", "1.1", "2"])
            root = temp / "offline"
            subprocess.run([
                sys.executable, str(SCRIPT),
                "--provider", "HISTDATA",
                "--asset", "EURUSD",
                "--source", str(raw),
                "--root", str(root),
            ], check=True, capture_output=True, text=True)
            out = root / "normalized" / "HISTDATA" / "EURUSD" / "EURUSD_1h_histdata.provenance.json"
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["provider"], "HISTDATA")
            self.assertEqual(payload["sourceGranularity"], "M1")
            self.assertEqual(payload["barConstruction"], "local_aggregation")
            self.assertTrue(payload["notNativeTwelveData"])
            self.assertTrue((root / "raw-archive" / "HISTDATA" / "EURUSD").is_dir())


if __name__ == "__main__":
    unittest.main()
