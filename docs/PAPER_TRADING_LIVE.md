# Automatic paper (virtual) trading — setup

Koi real order nahi. Engine sirf rules ko live candles par virtual chalata hai aur trade log banata hai.

## Kaise chalta hai
GitHub Actions (`.github/workflows/paper-trading.yml`) har ghante `research/v2_validation/paper_engine.py` chalata hai
-> Twelve Data (gold, BTC, ETH 1h) + Yahoo (Nifty, Bank Nifty, Sensex daily) se data -> `data/paper/trades.csv` + `summary.json` commit.
Commit message mein `[skip render]` hai, isliye Render har ghante redeploy nahi hota.
Engine har baar PAPER_START_DATE se replay karta hai, isliye Render ya GitHub ka koi disk reset kuch nahi bigadta, aur look-ahead nahi hai (test: pichhle waqt par chalane se same trades).

## Sleeves
| Sleeve | Kya | Equity mein |
|---|---|---|
| GOLD_NIGHT | XAU long Sun–Thu, 22:00 UTC ke baad pehle asli bar se 04:00 UTC bar open tak; size = 0.5% risk / trailing 5% kharab raat | haan |
| PAT4H_LONG | 4h FULL_W / FULL_N long (XAU, BTC, ETH), next open entry, 4 bar ya pattern stop | haan |
| SHADOW_FULL_IN / FULL_M / HALF_M | short patterns, sirf record | nahi |
| SHADOW_INDIA_NIGHT | Nifty/BankNifty/Sensex close -> next open | nahi |

Half-W/half-N/half-IN signals research reports mein hain; live mein sirf upar wale chalte hain kyunki backtest mein baaki ka edge nahi mila.

## Setup (ek baar)
1. GitHub repo -> Settings -> Secrets and variables -> Actions -> Secret `TWELVE_DATA_API_KEY` (wahi key jo Render par hai).
2. (Optional) Variables: `PAPER_START_DATE` (default 2026-11-10), `PAPER_CAPITAL` (100000), `PAPER_RISK_PCT` (0.5).
3. Repo -> Settings -> Actions -> General -> Workflow permissions = Read and write.
4. Code push karo. Actions tab -> paper-trading -> Run workflow (pehli baar haath se).
5. Render -> Environment: `PAPER_RAW_BASE=https://raw.githubusercontent.com/<USER>/<REPO>/main/data/paper` (private repo ho to ye kaam nahi karega; tab is variable ko mat lagao, Render redeploy par repo ki copy dikhayega).
6. Dekho: `https://<render-app>/api/paper/` (table), `/api/paper/summary`, `/api/paper/trades`, `/api/paper/trades.csv`. `data/paper/trades.csv` GitHub par seedha bhi khulta hai (Google Sheets mein bhi import ho jata hai).

## Kab nateeja parakhna
- Har sleeve ke kam se kam 100 closed trades. GOLD_NIGHT ke liye ~100 trading raatein (~5 mahine); 4h pattern sleeves mein trades kam aate hain, 3 instruments milakar bhi mahine mein ~8–10.
- Kill switch review: 60+ trades par average net < −1 bp, ya 10% drawdown -> ruko, parakho (`flag` field summary mein).
- Fills candle open par hain, asli bid/ask nahi; asli broker demo par 20–30 trades ka spread/slippage alag se naapo.
- Rules mat badlo. Badalna hai to naya PAPER_START_DATE.
- Twelve Data free limit: engine ~3 calls/ghanta (72/din), baaki app ke saath 800/din ke andar.

## Dashboard par kya dikhta hai (`/api/paper/`)
1. Sleeve table: trades, avg net bp, win %, t-stat, drawdown, backtest se compare (`expected_net_bp_from_backtest`).
2. Live candle: har symbol (XAU, BTC, ETH 1h/4h; Nifty, Bank Nifty, Sensex 1D) ki aakhri band candle ka shape (hammer, marubozu, doji, big...), close position, range/ATR, volatility regime.
3. Haal ke patterns: W/half-W/N/half-N (long) aur M/half-M/inverted-N (short) kab bane, stop/target, aur role (TRADED / shadow / info).
4. Har ghante update; poori history `trades.csv` mein.

(v5) Engine error text se key scrub hoti hai; workflow push se pehle pull --rebase karta hai (3 try).
