import pandas as pd
import numpy as np

from strategy.indicators import ema, atr
from strategy.regime import detect_regime
from strategy.backtest import run_backtest
from strategy.risk import RiskManager
from strategy.analytics import calculate_metrics
from strategy.ai_model import ai_confidence
from strategy.mtf import higher_tf_trend
from strategy.walkforward import walk_forward_split
from strategy.time_filter import is_trading_time
from strategy.volatility import is_volatile_enough
from strategy.trend_strength import strong_trend

np.random.seed(42)

data = pd.DataFrame({
    "close": np.cumsum(np.random.randn(500)) + 100,
})

data["high"] = data["close"] + np.random.rand(500)
data["low"] = data["close"] - np.random.rand(500)

data["ema_fast"] = ema(data["close"], 9)
data["ema_slow"] = ema(data["close"], 21)
data["atr"] = atr(data)

data = data.dropna().reset_index(drop=True)

data["regime"] = data.apply(detect_regime, axis=1)
data["htf_trend"] = data.apply(higher_tf_trend, axis=1)
data["strong_trend"] = data.apply(strong_trend, axis=1)
data["is_volatile"] = data.apply(is_volatile_enough, axis=1)
data["ai_score"] = data.apply(ai_confidence, axis=1)

# FIXED INDEX RESET (VERY IMPORTANT)
data = data[data.index.map(is_trading_time)].reset_index(drop=True)

train, test = walk_forward_split(data)

risk_manager = RiskManager()
trades = run_backtest(test, risk_manager)
metrics = calculate_metrics(trades)

print("==== PHASE 3A RESULTS ====")
for k, v in metrics.items():
    print(f"{k}: {v}")
