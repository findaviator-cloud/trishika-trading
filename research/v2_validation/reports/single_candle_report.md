# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 180. 5% par chance se |t|>2 ke ~9 aane chahiye; Bonferroni cutoff |t| >= 3.64.
Actual |t|>2: 36, |t|>3.6: 3

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
asset tf              shape    n  dev_bp     t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
  EUR 1h close_bottom(<=5%) 3934    0.90  5.01   0.88   0.91            -0.10             1.08             True
  BTC 1h close_bottom(<=5%) 3314    5.54  3.78   9.84   1.25            -2.46             1.11             True
  XAU 2h close_bottom(<=5%) 2447    2.16  3.65   1.82   2.50             0.66             1.01             True
  XAU 1h close_bottom(<=5%) 5060    1.05  3.58   1.34   0.76            -0.45             1.04             True
  EUR 1h   close_top(>=95%) 3481   -0.64 -3.58  -0.77  -0.52            -0.36             1.06             True
  XAU 1h   close_top(>=95%) 5028   -1.06 -3.51  -1.48  -0.63            -0.44             1.04             True
  BTC 1h   close_top(>=95%) 4296   -3.65 -3.31  -6.94  -0.36            -4.35             1.05             True
  EUR 1h      bull_marubozu 3202   -0.62 -3.23  -0.87  -0.36            -0.38             1.06             True
  EUR 1h      shooting_star 5287    0.50  3.23   0.61   0.40            -0.50             1.08             True
  BTC 2h   close_top(>=95%) 1789   -7.72 -3.20 -11.11  -4.33            -0.28             1.08             True
  EUR 2h close_bottom(<=5%) 1653    1.30  3.13   0.88   1.72             0.30             1.03             True
  BTC 1h      shooting_star 5665    2.87  3.07   4.86   0.89            -5.13             1.00             True
  BTC 2h      bear_marubozu 1315   11.64  3.05  21.14   2.16             3.64             1.24             True
  BTC 4h   close_top(>=95%)  797  -15.66 -3.03 -22.27  -9.08             7.66             1.11             True
  ETH 8h    big_down(>2ATR)  356  -55.79 -3.03 -74.05 -37.53            47.79             1.42             True
  XAU 2h      bear_marubozu 2234    2.01  3.01   2.31   1.71             0.51             1.06             True
  EUR 1h      bear_marubozu 3367    0.58  2.93   0.63   0.53            -0.42             1.11             True
  BTC 1h      bear_marubozu 3042    4.59  2.84   9.60  -0.42            -3.41             1.20            False

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein -11.75bp (+ = continuation, - = reversal) | 4/20 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein +1.56bp (+ = continuation, - = reversal) | 7/20 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein +7.17bp (+ = continuation, - = reversal) | 16/20 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein +1.92bp (+ = continuation, - = reversal) | 8/20 cells mein continuation
  close_bottom(<=5%)   candle disha DOWN: agli candle mein -14.62bp (+ = continuation, - = reversal) | 2/20 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein -0.79bp (+ = continuation, - = reversal) | 4/20 cells mein continuation
  hammer               candle disha UP: agli candle mein -4.06bp (+ = continuation, - = reversal) | 2/20 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein +0.95bp (+ = continuation, - = reversal) | 8/20 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_up(>2ATR)         1.39
big_down(>2ATR)       1.38
bear_marubozu         1.15
bull_marubozu         1.10
close_bottom(<=5%)    1.09
close_top(>=95%)      1.04
doji                  1.02
hammer                1.02
shooting_star         1.02
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)