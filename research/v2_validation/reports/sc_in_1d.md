# SINGLE CANDLE TEST - candle ke turant baad kya hota hai

Tests: 24. 5% par chance se |t|>2 ke ~1 aane chahiye; Bonferroni cutoff |t| >= 3.08.
Actual |t|>2: 0, |t|>3.1: 0

## dev_bp = agli candle ka average move (open->close) minus us market ka normal average. + = upar, - = neeche
## Sabse bade |t| (cost ke baad bhi edge hai ya nahi: edge_after_cost > 0)
    asset tf            shape   n  dev_bp     t  half1  half2  edge_after_cost  next_range_xATR  same_dir_halves
BANKNIFTY 1D           hammer 352  -13.37 -1.76 -11.00 -15.74             9.37             1.03             True
BANKNIFTY 1D    bull_marubozu 339   13.43  1.65  19.19   7.71             9.43             1.01             True
BANKNIFTY 1D    bear_marubozu 334  -14.33 -1.63 -24.57  -4.09            10.33             1.11             True
BANKNIFTY 1D  big_down(>2ATR) 114   22.95  1.50 -22.53  68.43            18.95             1.34            False
    NIFTY 1D    bull_marubozu 359   11.04  1.44  20.17   1.95             7.04             0.93             True
    NIFTY 1D           hammer 386   -8.82 -1.41 -13.70  -3.94             4.82             1.04             True
BANKNIFTY 1D    shooting_star 240   10.44  1.10  14.11   6.76             6.44             0.99             True
   SENSEX 1D    big_up(>2ATR)  56  -19.26 -1.07 -26.07 -12.45            15.26             1.18             True
BANKNIFTY 1D    big_up(>2ATR)  93  -13.13 -0.84  -5.95 -20.16             9.13             1.19             True
    NIFTY 1D    bear_marubozu 355   -5.85 -0.81 -23.07  11.27             1.85             1.15            False
   SENSEX 1D  big_down(>2ATR) 119    9.00  0.72  -5.18  22.93             5.00             1.33            False
BANKNIFTY 1D close_top(>=95%)  56   -9.71 -0.69  12.22 -31.64             5.71             0.98            False
   SENSEX 1D           hammer 354   -3.39 -0.60  -2.21  -4.57            -0.61             1.05             True
    NIFTY 1D    shooting_star 188   -4.80 -0.56  -8.41  -1.18             0.80             0.98             True
    NIFTY 1D close_top(>=95%)  64    6.54  0.50  16.49  -3.41             2.54             0.97            False
   SENSEX 1D    bull_marubozu 377    2.34  0.42  -5.97  10.61            -1.66             0.90            False
    NIFTY 1D  big_down(>2ATR) 121    5.51  0.37 -14.69  25.37             1.51             1.37            False
BANKNIFTY 1D             doji 422   -1.72 -0.23   9.51 -12.94            -2.28             1.01            False

## Reversal ya continuation? (candle ki disha ke hisaab se, saare assets/TFs ka average)
  bear_marubozu        candle disha DOWN: agli candle mein +6.56bp (+ = continuation, - = reversal) | 2/3 cells mein continuation
  big_down(>2ATR)      candle disha DOWN: agli candle mein -12.48bp (+ = continuation, - = reversal) | 0/3 cells mein continuation
  big_up(>2ATR)        candle disha UP: agli candle mein -11.75bp (+ = continuation, - = reversal) | 0/3 cells mein continuation
  bull_marubozu        candle disha UP: agli candle mein +8.94bp (+ = continuation, - = reversal) | 3/3 cells mein continuation
  close_top(>=95%)     candle disha UP: agli candle mein -0.77bp (+ = continuation, - = reversal) | 2/3 cells mein continuation
  hammer               candle disha UP: agli candle mein -8.53bp (+ = continuation, - = reversal) | 0/3 cells mein continuation
  shooting_star        candle disha DOWN: agli candle mein -1.34bp (+ = continuation, - = reversal) | 2/3 cells mein continuation

## Agli candle ki size (ATR ke multiple mein) - 'kitna move hoga' ka andaza
shape
big_down(>2ATR)     1.35
big_up(>2ATR)       1.16
bear_marubozu       1.13
hammer              1.04
doji                1.03
shooting_star       0.98
bull_marubozu       0.95
close_top(>=95%)    0.95
  (normal candle ~1.0x ATR; zyada = us shape ke baad market zyada hilta hai)