# TRISHIKA GOLD EDGE VALIDATION V2

Data: 2010-01-01 00:00:00+00:00 -> 2020-12-30 23:00:00+00:00  (65941 bars)  bid/ask: False
Base: entry 22:00 UTC, exit 04:00 UTC, cost 1.5bp, swap 0.0bp

## 1. Base result (gross) aur cost sweep
n=2837  mean=+5.09bp  hit=56.6%  t_naive=7.50  t_HAC=7.04  Sharpe~2.23
  cost+swap= 0.0bp -> net mean +5.09bp
  cost+swap= 1.5bp -> net mean +3.59bp
  cost+swap= 2.5bp -> net mean +2.59bp
  cost+swap= 3.5bp -> net mean +1.59bp
  cost+swap= 5.0bp -> net mean +0.09bp
  Break-even round-trip cost: 5.09bp

## 2. Serial correlation: HAC aur block bootstrap
  naive t = 7.50   HAC (Newey-West) t = 7.04   (HAC bahut kam aaye to autocorrelation ne t inflate kiya)
  lag-1 autocorrelation = 0.001
  Net mean 95% CI (stationary bootstrap, block~14): [+2.03, +5.11] bp
  CI zero ko include karta hai? Nahi

## 3. Entry/exit time sensitivity (overfitting check)
  (bars 60-min ke hain, isliye grid 60-min steps mein)
exit   02:00  03:00  04:00  05:00  06:00
entry                                   
00:00  -1.05  -0.09  -0.39  -0.60   0.36
20:00   0.48   1.42   1.36   1.07   1.83
21:00   1.48   2.36   2.25   2.03   2.79
22:00   2.93   3.88   3.59   3.37   4.34
23:00   1.23   2.19   1.89   1.67   2.63

  Grid cells jahan net>0: 84%  (25 cells)
  Agar sirf ek exact cell positive hai aur padosi negative -> overfitting.

## 4. Multiple testing (Deflated Sharpe, Bonferroni)
  Trials counted (sirf is grid ke): 25. Apne purane saare tests jodein to ye number badhao.
  Sharpe/night = 0.0993, expected-max-by-luck SR0 = 0.0799
  Deflated Sharpe probability = 0.865   (>0.95 acceptable, <0.5 = luck ke barabar)
  HAC p-value (net) = 6.944e-07, Bonferroni(25) = 1.736e-05

## 5. Untouched holdout (cutoff 2018-01-01)
  In-sample : n=2063  mean=+4.44bp  hit=56.1%  t_naive=5.38  t_HAC=5.16  Sharpe~1.88
  Holdout   : n=774   mean=+1.32bp  hit=50.0%  t_naive=1.14  t_HAC=1.09  Sharpe~0.65
  NOTE: holdout par parameter tune mat kariye. Ek baar dekhne ke baad wo 'untouched' nahi raha.

## 6. Stability: saal-dar-saal aur weekday
      count   mean
date              
2010    260   5.59
2011    259  11.17
2012    258   4.68
2013    257   1.17
2014    257   0.73
2015    257   1.59
2016    258   6.92
2017    257   3.62
2018    258   1.78
2019    258   0.61
2020    258   1.57

     count  mean
Mon    570  3.52
Tue    568  3.71
Wed    570  4.91
Thu    562  3.53
Sun    567  2.28
  (weekday = ENTRY ki raat; Fri/Sat entry kam hone chahiye kyunki market band hota hai)
  Wednesday night par zyada swap lagta hai (triple swap) - broker se check karein.

## 7. Bid/ask execution
  CSV me bid/ask columns nahi. Tick/bid-ask data laayein; bina uske cost sirf assumption hai.

## 8. Independent data-source verification
  --other nahi diya. Doosre provider ka CSV dein (e.g. Dukascopy vs broker feed).

## Verdict checklist
  [PASS] HAC t > 3 (net)
  [PASS] Bootstrap CI zero ke upar
  [FAIL] Deflated Sharpe > 0.95
  [PASS] Holdout net > 0
  [PASS] Padosi entry times positive (>=60% cells)

Sab PASS bhi ho to ye 'research hypothesis' hi hai. Agla step: 100+ night paper trading with actual bid/ask.