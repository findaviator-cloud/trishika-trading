# GOLD OVERNIGHT PROBABILITY CARD

Raatein: 4327  (2010-01-31 -> 2026-11-05), flat = |move| < 2.0bp, cost 1.5bp

## 1. Base rate (poori history)
  UP 53.4%  |  FLAT 6.2%  |  DOWN 40.4%
  Move percentiles (bp): 5%=-48.0, 25%=-12.9, median=4.7, 75%=22.7, 95%=64.2
  Mean +5.35bp, net of cost +3.85bp, trade jeetne ka chance (net>0): 54.3%

## 2. Walk-forward test: context se andaza behtar hota hai ya nahi?
  Test nights: 3570 (har saal sirf pichle saalon se seekha)
  Brier score: model 0.2495 vs sirf base-rate 0.2499  (model kam ho tabhi context kaam ka)
  AUC: 0.536  (0.50 = koi jaankari nahi, 0.55+ = halki, 0.60+ = achhi)

  Calibration (predicted vs actual jeetne ka chance):
             nights  predicted  actual
b                                     
(0.0, 0.45]     168      0.412   0.423
(0.45, 0.5]     452      0.480   0.522
(0.5, 0.55]    1162      0.528   0.513
(0.55, 0.6]    1144      0.572   0.547
(0.6, 1.0]      644      0.648   0.576

  Nateeja: context se KOI saaf fayda nahi - base rate hi sabse sachcha andaza hai

## 3. Aaj raat ka card (latest data ke hisaab se)
  Aakhri raat (2026-11-05): -95.1bp | pichle 20 raat ka mean +12.5bp | vol 71.2bp
  P(trade net jeete) = 54%   (base rate)
  P(UP) ~53% | P(FLAT) ~6% | P(DOWN) ~40%
  Typical range (50% raatein): -13 se +23bp; kharab raat (5%): -48bp

## 4. Reverse (short / put) ka sach
  Long net +3.85bp | Short (har raat ulta) net -6.85bp  -> short khud ek negative strategy hai (cost + drift)
  jab pichli raat gir gayi thi: n=1884, long net +3.71bp (t=+3.9), short net -6.71bp
  jab pichla din gir gaya tha: n=2045, long net +4.14bp (t=+4.5), short net -7.14bp
  jab 20-raat ka mean negative: n=1070, long net +2.24bp (t=+1.6), short net -5.24bp
  Agar kisi condition mein short ka net bhi positive aur t>3 na ho, to 'ulta' lagana sirf ek soch hai, edge nahi.

## 5. Position size ka tareeka (probability ke hisaab se, chhota rakhein)
  Agar kharab raat (5% wali, -48bp) mein capital ka 0.5% se zyada nahi khona: notional = capital ka 104% (yaani ~1.0x)
  Agar kharab raat (5% wali, -48bp) mein capital ka 1.0% se zyada nahi khona: notional = capital ka 208% (yaani ~2.1x)
  Ye maximum hai, target nahi. Paper trading mein pehle 0.25x se shuru karein. Kisi raat ka nuksaan 5% se bhi bura ho sakta hai (worst raat dekhiye neeche).
  Ab tak ki sabse buri raat: -356bp (2026-02-01), sabse achhi: +685bp

## 6. Volatility: aaj raat kitna hil sakta hai
        nights  avg_abs_bp  5%_bad  95%_good  win%_net
regime                                                
LOW       1443        17.9   -32.1      43.0      55.0
MID       1442        23.5   -39.8      53.2      54.2
HIGH      1442        37.3   -72.0      91.2      53.8
  Jab pichle 20 raat ki vol HIGH thi, agli raat ka average move LOW se 2.1x tha - vol 'kitna' batati hai, 'kis taraf' nahi (win% lagbhag ek jaisa).
  Abhi (pichli 20 raat ke hisaab se) regime: HIGH  -> kharab raat (5%) ka andaza -72bp, achhi raat (95%) +91bp
  Is regime mein capital ka 0.5% se zyada na khone ke liye max notional = capital ka 69%  (LOW regime mein zyada, HIGH mein kam - size vol ke hisaab se badlein)
  Pichla din bada move (2x normal) tha: 567 raatein, agli raat ka avg |move| 38.7bp vs normal 24.4bp (1.59x), long net +7.7bp vs +3.3bp