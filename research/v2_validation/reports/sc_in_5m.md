# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 49. 5% par chance se |t|>2 ke ~2 aane chahiye; Bonferroni cutoff |t| >= 3.28.
Actual |t|>2: 2, |t|>3.3: 0

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
    asset    tf              shape   n  dev_bp     t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
   SENSEX  5min      big_up(>2ATR)  81   -4.37 -3.21  -3.44  -5.28             0.37             1.68             True
   SENSEX  5min close_bottom(<=5%) 302    2.17  2.89   1.04   3.30            -1.83             1.53             True
   SENSEX 15min             hammer  81    2.98  1.94   2.51   3.43            -1.02             1.06             True
   SENSEX  5min      bear_marubozu 254    1.63  1.85   0.15   3.12            -2.37             1.64             True
BANKNIFTY  5min      big_up(>2ATR)  63   -3.14 -1.72  -4.28  -2.04            -0.86             1.67             True
BANKNIFTY 15min      bull_marubozu  72   -5.01 -1.64  -3.35  -6.66             1.01             1.78             True
BANKNIFTY  5min      bull_marubozu 178   -1.69 -1.58  -1.03  -2.34            -2.31             1.49             True
   SENSEX 15min   close_top(>=95%)  83    2.14  1.55   0.27   3.97            -1.86             1.07             True
    NIFTY 15min             hammer  74    2.76  1.49  -0.08   5.60            -1.24             0.88            False
BANKNIFTY  5min               doji 270    0.63  1.35  -0.27   1.53            -3.37             0.98            False
BANKNIFTY  5min      shooting_star 185    0.74  1.20   0.85   0.63            -3.26             0.93             True
BANKNIFTY  5min close_bottom(<=5%) 182    0.97  1.10   2.22  -0.27            -3.03             1.19            False
   SENSEX  5min   close_top(>=95%) 252   -0.64 -1.07  -0.98  -0.29            -3.36             1.27             True
    NIFTY  5min      big_up(>2ATR)  66   -2.06 -1.05  -3.70  -0.41            -1.94             1.90             True
BANKNIFTY  5min   close_top(>=95%) 167   -1.23 -1.04  -0.05  -2.39            -2.77             1.55             True
    NIFTY  5min    big_down(>2ATR)  63   -1.68 -0.96  -0.78  -2.56            -2.32             1.59             True
   SENSEX 15min      bull_marubozu  61   -1.61 -0.92  -1.17  -2.03            -2.39             0.93             True
   SENSEX  5min      bull_marubozu 259   -0.52 -0.90  -1.24   0.20            -3.48             1.16            False

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein -0.51bp (+ = continuation, - = reversal) | 2/6 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein +1.01bp (+ = continuation, - = reversal) | 3/3 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein -2.49bp (+ = continuation, - = reversal) | 0/4 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein -1.83bp (+ = continuation, - = reversal) | 1/6 cells mein continuation
  close_bottom(<=5%)   candle disha DOWN: agli candle mein -0.41bp (+ = continuation, - = reversal) | 2/6 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein -0.36bp (+ = continuation, - = reversal) | 2/6 cells mein continuation
  hammer               candle disha UP: agli candle mein +1.10bp (+ = continuation, - = reversal) | 4/6 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein +0.24bp (+ = continuation, - = reversal) | 5/6 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_up(>2ATR)         1.79
big_down(>2ATR)       1.59
close_top(>=95%)      1.46
bull_marubozu         1.42
bear_marubozu         1.41
close_bottom(<=5%)    1.29
doji                  0.98
shooting_star         0.96
hammer                0.94
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)