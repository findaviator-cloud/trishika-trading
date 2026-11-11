# GOLD PROBABILITY CARD V2 - candles + patterns

Raatein: 4327 (2010-01-31 -> 2026-11-05), cost 1.5bp, win = net>0

## 1. Walk-forward (har saal sirf pichle saalon se seekha)
Model                           Brier    AUC   test years AUC>0.5
A: base rate                   0.2499  0.500                    -
B: sirf purana context         0.2494  0.536                12/14
C: + candles                   0.2496  0.543                14/14
D: + patterns (W/M/N)          0.2500  0.537                11/14
E: + candles + patterns        0.2502  0.546                12/14

  Brier jitna kam utna behtar. AUC 0.50 = koi jaankari nahi; 0.55+ halki; 0.60+ achhi.

## 2. Har candle/pattern flag ka akela asar (jab flag ON tha, raat ka net bp)
      flag   n  net_bp_ON  net_bp_OFF  win%_ON  t_ON
 FULL_W_4h 173       9.23        3.63    59.54  3.06
 HALF_M_4h 352       5.38        3.72    58.81  2.93
 FULL_N_4h 254       6.69        3.68    52.76  2.67
FULL_IN_4h 228       7.16        3.67    59.21  2.49
 HALF_N_4h 371       3.92        3.85    53.37  2.40
 HALF_W_4h 335       3.73        3.86    54.93  2.38
HALF_IN_4h 379       5.07        3.74    57.26  2.29
 FULL_M_1D  85       6.15        3.81    63.53  2.00
extreme_lo 146      11.10        3.60    65.75  1.85
 HALF_M_1D 162       4.38        3.83    54.94  1.30
 FULL_N_1D 120       3.82        3.86    45.00  1.03
 HALF_N_1D 194       1.60        3.96    52.58  0.66
 FULL_M_4h 183       1.09        3.98    50.27  0.43
FULL_IN_1D 108       0.90        3.93    54.63  0.19
 FULL_W_1D  90       0.03        3.94    42.22  0.01
HALF_IN_1D 179      -0.53        4.04    46.93 -0.19
extreme_hi 151      -4.77        4.17    39.07 -0.95
 HALF_W_1D 163      -4.69        4.19    44.79 -1.61

  Yaad rakhein: 18 flags test hue; 5% par Bonferroni ke baad |t| >= 3.0 chahiye (neeche ke naam se ek-do hi zyada se zyada).

## 3. Faisla
  Sabse achha candle/pattern model: E: + candles + patterns  (AUC 0.546, Brier 0.2502)
  Candles/patterns jodne se andaza KAAM LAYAK behtar NAHI hua. Base rate (54%) hi sabse sachcha number hai.