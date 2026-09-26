import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def assert_contains(path: Path, text: str) -> None:
    source = path.read_text(encoding="utf-8")
    normalized_source = "".join(source.split())
    normalized_text = "".join(text.split())
    assert normalized_text in normalized_source, (
        f"Missing required contract text in {path}: {text}"
    )


def main() -> None:
    config = json.loads(
        (ROOT / "config" / "fx_gold_walkforward.json").read_text(encoding="utf-8")
    )

    assert "EUR_USD" in config["assets"]
    assert "XAU_USD" in config["assets"]

    for asset in ("EUR_USD", "XAU_USD"):
        window = config["assets"][asset]["windows"]["4h"]
        assert window["train_bars"] == 1080
        assert window["test_bars"] == 180
        assert window["step_bars"] == 180
        assert window["warmup_bars"] == 250
        assert window["anchored"] is False

    refresh = ROOT / "src" / "strategy" / "fx_gold" / "research_refresh.js"
    scheduler = ROOT / "src" / "strategy" / "fx_gold" / "research_scheduler.js"
    route = ROOT / "src" / "routes" / "forex_research.js"
    runner = ROOT / "scripts" / "run_fx_gold_walkforward.py"
    fetcher = ROOT / "scripts" / "fetch_twelvedata_ohlc.py"

    assert_contains(refresh, "fetchTwelveDataJson")
    assert_contains(refresh, "run_fx_gold_walkforward.py")
    assert_contains(refresh, "outcome: 'skipped_already_running'")
    assert_contains(route, "x-forex-research-refresh-secret")
    assert_contains(route, "function parseRefreshScope(req)")
    assert_contains(route, "Provide both supported query parameters symbol and timeframe")
    assert_contains(route, "error: 'INVALID_REFRESH_SCOPE'")
    assert_contains(route, "scope: parsedScope.scope")
    assert_contains(refresh, "function normalizeRefreshOptions(options = {})")
    assert_contains(refresh, "function selectRefreshJobs(scope)")
    assert_contains(refresh, "requestedReports: jobs.length")
    assert_contains(refresh, "completedReports: results.length")
    assert_contains(refresh, "scope.mode === 'single'")
    assert_contains(scheduler, "03:30 IST")
    assert_contains(scheduler, "lastSkipReason")
    assert_contains(scheduler, "lastOutcome")

    assert_contains(refresh, "twelveInterval: '4h'")
    assert_contains(refresh, "FX_GOLD_RESEARCH_LOOKBACK_DAYS_4H")
    assert_contains(route, "'4h': '4h'")
    assert_contains(route, "['1h', '4h', '1day']")
    assert_contains(fetcher, '"4h": "4h"')
    assert_contains(runner, 'choices=["1h", "4h", "1day", "1d"]')

    assert_contains(runner, '"status": "INSUFFICIENT_DATA"')
    assert_contains(runner, '"DATA_QUALITY_FAILED"')
    assert_contains(runner, '"INSUFFICIENT_WARMUP"')
    assert_contains(runner, '"INSUFFICIENT_FOLDS"')
    assert_contains(runner, '"INSUFFICIENT_TRADES"')
    assert_contains(runner, '"validCompletedFolds"')
    assert_contains(runner, '"researchOnly"')
    assert_contains(runner, '"humanReviewRequired"')
    assert_contains(runner, '"provider": "TWELVE_DATA"')

    assert_contains(ROOT / ".gitignore", "data/EURUSD_4h.csv")
    assert_contains(ROOT / ".gitignore", "data/XAUUSD_4h.csv")

    print("Native 4h contract validation passed.")
    print("Golden Rule / report safety contract validation passed.")
    print("FX/Gold contract validation passed.")

    assert_contains(refresh, 'const MAX_CONCURRENT_REFRESHES = 2')
    assert_contains(refresh, 'const activeRefreshes = new Map()')
    assert_contains(refresh, 'function scopesConflict(left, right)')
    assert_contains(refresh, "'scope-conflict'")
    assert_contains(refresh, "reason: 'capacity-reached'")
    assert_contains(refresh, 'activeRefreshes.delete(key)')
    assert_contains(route, "result.reason === 'capacity-reached'")

if __name__ == "__main__":
    main()
