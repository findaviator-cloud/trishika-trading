# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 108. 5% par chance se |t|>2 ke ~5 aane chahiye; Bonferroni cutoff |t| >= 3.50.
Actual |t|>2: 16, |t|>3.5: 7

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
asset    tf              shape     n  dev_bp      t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
  BTC  1min close_bottom(<=5%) 27906   -0.28 -11.70  -0.24  -0.31            -7.72             1.10             True
  BTC  1min   close_top(>=95%) 28471    0.27  11.44   0.25   0.30            -7.73             1.18             True
  BTC  1min      bear_marubozu 22915   -0.21  -8.12  -0.20  -0.23            -7.79             1.12             True
  BTC  1min      bull_marubozu 22655    0.19   6.99   0.14   0.23            -7.81             1.15             True
  ETH  1min   close_top(>=95%) 21044    0.25   6.46   0.25   0.25            -7.75             1.09             True
  ETH  1min close_bottom(<=5%) 21373   -0.20  -5.42  -0.12  -0.28            -7.80             1.04             True
  BTC  1min             hammer  4580    0.40   5.06   0.35   0.44            -7.60             1.05             True
  EUR  1min      bull_marubozu  6211    0.04   3.21   0.01   0.06            -0.56             1.04             True
  ETH  1min             hammer  5526    0.28   3.01   0.33   0.23            -7.72             1.07             True
  EUR  1min   close_top(>=95%)  8430    0.02   2.66   0.02   0.03            -0.58             1.03             True
  XAU  5min close_bottom(<=5%)   943    0.59   2.62   0.88   0.30            -0.91             1.02             True
  BTC 15min      bull_marubozu   517    1.94   2.38   2.36   1.52            -6.06             1.11             True
  ETH  5min      big_up(>2ATR)   575   -2.42  -2.26  -1.15  -3.69            -5.58             1.61             True
  ETH 15min      shooting_star   466    1.94   2.09   4.54  -0.67            -6.06             0.99            False
  ETH  1min      bull_marubozu 16959    0.09   2.04   0.10   0.08            -7.91             1.10             True
  EUR  5min close_bottom(<=5%)  1142   -0.11  -2.00   0.03  -0.26            -0.49             1.06            False
  BTC  1min      shooting_star  4657   -0.15  -1.98  -0.04  -0.26            -7.85             1.06             True
  ETH  1min      big_up(>2ATR)  3815   -0.29  -1.96  -0.19  -0.38            -7.71             1.57             True

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein +0.03bp (+ = continuation, - = reversal) | 5/12 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein -0.73bp (+ = continuation, - = reversal) | 3/12 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein -0.47bp (+ = continuation, - = reversal) | 3/12 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein +0.10bp (+ = continuation, - = reversal) | 7/12 cells mein continuation
  close_bottom(<=5%)   candle disha DOWN: agli candle mein +0.13bp (+ = continuation, - = reversal) | 8/12 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein +0.17bp (+ = continuation, - = reversal) | 7/12 cells mein continuation
  hammer               candle disha UP: agli candle mein +0.03bp (+ = continuation, - = reversal) | 6/12 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein -0.10bp (+ = continuation, - = reversal) | 7/12 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_up(>2ATR)         1.57
big_down(>2ATR)       1.56
bull_marubozu         1.10
bear_marubozu         1.08
close_top(>=95%)      1.07
close_bottom(<=5%)    1.05
doji                  1.05
hammer                1.05
shooting_star         1.02
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)