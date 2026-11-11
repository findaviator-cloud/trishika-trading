# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 144. 5% par chance se |t|>2 ke ~7 aane chahiye; Bonferroni cutoff |t| >= 3.58.
Actual |t|>2: 12, |t|>3.6: 0

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
asset    tf              shape    n  dev_bp     t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
  XAU  5min close_bottom(<=5%) 2502    0.51  3.04   0.46   0.55            -0.99             1.04             True
  BTC 15min      bull_marubozu 1439    1.59  2.82   1.09   2.09            -6.41             1.08             True
  EUR  5min             hammer 2483   -0.10 -2.54  -0.14  -0.05            -0.50             1.03             True
  EUR 30min               doji  657    0.41  2.45   0.66   0.15            -0.19             1.02             True
  ETH 30min      shooting_star  678   -3.82 -2.38  -4.16  -3.48            -4.18             1.02             True
  EUR 30min             hammer  454   -0.44 -2.28  -0.45  -0.44            -0.16             0.99             True
  EUR  5min      big_up(>2ATR)  961    0.21  2.24   0.26   0.17            -0.39             1.48             True
  BTC 15min             hammer 1328   -1.18 -2.22  -0.97  -1.38            -6.82             1.04             True
  EUR  5min               doji 3641   -0.07 -2.14  -0.12  -0.01            -0.53             1.02             True
  XAU  5min    big_down(>2ATR)  745    0.97  2.12   0.62   1.31            -0.53             1.48             True
  EUR  5min    big_down(>2ATR)  876    0.20  2.06   0.28   0.12            -0.40             1.49             True
  EUR 15min             hammer  904   -0.24 -2.04  -0.17  -0.32            -0.36             1.06             True
  EUR    1h      shooting_star  228    0.87  1.99   0.25   1.49             0.27             1.07             True
  BTC 15min close_bottom(<=5%) 1833   -0.84 -1.89  -1.12  -0.56            -7.16             1.07             True
  EUR 30min   close_top(>=95%)  369   -0.44 -1.85   0.01  -0.88            -0.16             1.11            False
  XAU 15min      bull_marubozu  640   -1.26 -1.84  -1.75  -0.77            -0.24             1.16             True
  ETH 30min             hammer  657    2.43  1.81   2.57   2.28            -5.57             1.01             True
  EUR    1h   close_top(>=95%)  158   -1.00 -1.78  -0.91  -1.09             0.40             1.19             True

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein -0.14bp (+ = continuation, - = reversal) | 4/16 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein -0.22bp (+ = continuation, - = reversal) | 4/16 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein +0.18bp (+ = continuation, - = reversal) | 7/16 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein -0.22bp (+ = continuation, - = reversal) | 6/16 cells mein continuation
  close_bottom(<=5%)   candle disha DOWN: agli candle mein +0.64bp (+ = continuation, - = reversal) | 9/16 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein +0.01bp (+ = continuation, - = reversal) | 7/16 cells mein continuation
  hammer               candle disha UP: agli candle mein -0.24bp (+ = continuation, - = reversal) | 4/16 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein -0.24bp (+ = continuation, - = reversal) | 5/16 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_down(>2ATR)       1.58
big_up(>2ATR)         1.57
bear_marubozu         1.11
bull_marubozu         1.10
close_top(>=95%)      1.10
close_bottom(<=5%)    1.06
doji                  1.03
hammer                1.03
shooting_star         1.02
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)