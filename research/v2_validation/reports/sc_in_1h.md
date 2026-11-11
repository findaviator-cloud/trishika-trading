# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 53. 5% par chance se |t|>2 ke ~2 aane chahiye; Bonferroni cutoff |t| >= 3.31.
Actual |t|>2: 2, |t|>3.3: 0

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
    asset tf            shape   n  dev_bp     t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
    NIFTY 1h close_top(>=95%) 258    3.96  2.35   3.65   4.27            -0.04             1.10             True
BANKNIFTY 2h             doji 225    5.76  2.31   4.79   6.73             1.76             1.01             True
    NIFTY 1h    bull_marubozu 222    3.42  1.89   3.53   3.30            -0.58             1.09             True
   SENSEX 1h           hammer 280   -2.79 -1.80  -0.90  -4.68            -1.21             1.08             True
   SENSEX 2h    bear_marubozu 132    4.47  1.70   9.04  -0.09             0.47             1.08            False
BANKNIFTY 2h           hammer 156    4.80  1.69   5.26   4.34             0.80             1.02             True
    NIFTY 2h  big_down(>2ATR)  50    8.17  1.62   7.16   9.18             4.17             1.35             True
   SENSEX 2h  big_down(>2ATR)  47    7.71  1.60  11.77   3.81             3.71             1.31             True
    NIFTY 2h    shooting_star 119    4.85  1.56   2.86   6.81             0.85             1.15             True
   SENSEX 1h             doji 339   -1.99 -1.53  -1.08  -2.89            -2.01             1.06             True
   SENSEX 1h    bull_marubozu 235    2.86  1.50   2.73   2.99            -1.14             1.20             True
   SENSEX 2h             doji 191    3.74  1.49   2.94   4.53            -0.26             1.08             True
   SENSEX 2h           hammer 142    3.56  1.45   3.80   3.32            -0.44             1.04             True
BANKNIFTY 1h close_top(>=95%) 235    3.53  1.43   3.64   3.42            -0.47             1.23             True
BANKNIFTY 2h    shooting_star 119    5.01  1.33   8.23   1.84             1.01             1.06             True
BANKNIFTY 1h    bull_marubozu 214    3.24  1.31   2.27   4.21            -0.76             1.21             True
BANKNIFTY 2h    bull_marubozu 103    4.06  1.28   2.59   5.49             0.06             0.96             True
BANKNIFTY 1h    shooting_star 212   -2.59 -1.28  -3.68  -1.51            -1.41             1.04             True

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein -2.27bp (+ = continuation, - = reversal) | 1/6 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein -4.00bp (+ = continuation, - = reversal) | 0/5 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein +0.04bp (+ = continuation, - = reversal) | 3/6 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein +2.54bp (+ = continuation, - = reversal) | 6/6 cells mein continuation
  close_bottom(<=5%)   candle disha DOWN: agli candle mein +0.07bp (+ = continuation, - = reversal) | 3/6 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein +1.80bp (+ = continuation, - = reversal) | 5/6 cells mein continuation
  hammer               candle disha UP: agli candle mein +1.37bp (+ = continuation, - = reversal) | 4/6 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein -1.24bp (+ = continuation, - = reversal) | 3/6 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_down(>2ATR)       1.28
close_bottom(<=5%)    1.16
bear_marubozu         1.13
big_up(>2ATR)         1.12
shooting_star         1.11
close_top(>=95%)      1.10
bull_marubozu         1.06
doji                  1.02
hammer                1.02
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)