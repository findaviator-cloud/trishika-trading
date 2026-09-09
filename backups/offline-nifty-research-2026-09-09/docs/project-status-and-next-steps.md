# Trishika Trading — Project Status and Next Steps

**Document purpose:** This is a practical handover and continuity document for the Trishika Trading project. It records what has been built, what has been verified, which safety boundaries are active, what is not yet proven, and what should happen next.

**Last updated:** 2026-09-07
**Current operating mode:** Analysis-only and human-gated research/shadow observation
**Automatic trading:** Disabled
**Live-capital trading:** Not approved

---

## 1. Project objective

The project is being built to analyse markets and show directional context:

```text
LONG_BIAS
SHORT_BIAS
NEUTRAL
```

The current goal is to observe market structure, trend direction, breakout conditions, and multi-timeframe alignment across Crypto and Forex.

This is **not** currently an automated trading system.

```text
No broker order placement
No automatic execution
No live-capital approval
No automatic paper-trade creation
Human review required for shadow workflow decisions
```

A directional label means market-analysis context only:

```text
LONG_BIAS  = bullish directional context
SHORT_BIAS = bearish directional context
NEUTRAL    = no confirmed configured breakout context
```

It must not be interpreted as a guaranteed prediction, a trade command, or investment advice.

---

## 2. Current market scope

### Active / analysis-capable

```text
Crypto:
BTC/USD
ETH/USD
SOL/USD
BNB/USD

Forex / Gold:
EUR/USD
XAU/USD
```

### Deferred / disabled

```text
NSE F&O:
Disabled by default.

Angel One WebSocket:
Disabled unless explicitly enabled through:
ENABLE_ANGEL_ONE_WS=true

Forex execution:
Not implemented or approved.

Crypto execution:
Not implemented or approved.
```

---

## 3. Major achievements

### 3.1 Crypto research and 4H shadow workflow

The Crypto 4H research/shadow workflow has been built and reviewed as a separate workflow from existing 1H production-style signals.

Recorded verification status:

```text
4H shadow parity: PASS — 57/57
Freshness and UTC-boundary validation: PASS — 37/37
Human-decision audit: PASS — 4/4 coverage, 36/36 checks
Manual paper-trade ledger: PASS — 1/1
Lock-readiness audit: SHADOW_INFRASTRUCTURE_READY — 6/6
```

The intended operating boundary is:

```text
Research: enabled
4H shadow observation: enabled
Human decision: required
Manual paper ledger: enabled for eligible accepted cases
Automatic paper trading: disabled
Order routing: disabled
Execution: disabled
Live capital: not approved
```

Crypto 4H shadow output remains separate from the existing live 1H signal path.

---

### 3.2 Crypto 1H EMA confirmation overlay

An informational 1D EMA(200) confirmation overlay was added for Crypto.

Committed source change:

```text
68a1c65 Add informational daily EMA confirmation overlay
```

Approved intended behavior:

```text
BTC / ETH / BNB:
Daily EMA(200) context available when provider data is available.

SOL:
EMA confirmation intentionally suppressed / N/A.

Forex:
No use of this Crypto EMA module.

F&O:
No use of this Crypto EMA module.

Automation:
false.
```

The overlay is informational only and does not modify:

```text
Donchian entry logic
Donchian exit logic
Signal direction
Order routing
Execution
Live-capital permissions
```

### Current Render limitation

Render logs showed Binance-related EMA requests failing gracefully:

```text
[EMA_CONFIRMATION] BTC refresh failed: Unexpected Binance response
[EMA_CONFIRMATION] ETH refresh failed: Unexpected Binance response
[EMA_CONFIRMATION] BNB refresh failed: Unexpected Binance response
```

The main running Crypto candle pipeline uses Twelve Data because the service reports that Binance is blocked/unavailable in the Render runtime.

Current safe interpretation:

```text
Crypto EMA overlay may display N/A on Render.
This does not affect the Crypto Donchian pipeline.
This does not affect the Crypto 4H shadow workflow.
This does not affect execution safety because execution is disabled.
```

No Yahoo Finance or F&O proxy fallback should be added to this EMA module.

---

### 3.3 Generated-data Git hygiene

A Git ignore policy was added and committed to prevent generated research/runtime artifacts from being staged by default.

Committed source change:

```text
186c8cb Ignore generated trading research artifacts
```

Ignored categories include:

```text
data/backtest-results/
data/shadow-live-1h/
data/fno-input/
data/historical/
data/historical-1d/
data/historical-4h/
data/trades.db-wal
data/trades.db-shm
signals_live/
```

Important Git limitation:

```text
.gitignore prevents future untracked generated files from being added.
It does not automatically remove files that were already tracked in earlier commits.
```

Large historical/backtest artifacts may already exist in repository history and should be handled later through a deliberate cleanup review, not an impulsive history rewrite.

---

### 3.4 Angel One 429 reconnect-loop protection

Render logs showed repeated Angel One WebSocket rejection:

```text
Angel One feed WS: Unexpected server response: 429
Angel One feed WS closed — reconnecting in 60s...
```

The old connector had an indefinite reconnect behavior after socket close. This created unnecessary provider connection attempts, logs, and potential outbound bandwidth use.

A narrow safety gate was added, committed, pushed, and deployed:

```text
dbf99d0 Disable Angel One feed unless explicitly enabled
```

The guard is in:

```text
src/angel/index.js
```

Behavior:

```text
ENABLE_ANGEL_ONE_WS=true
→ Angel One login is allowed.

ENABLE_ANGEL_ONE_WS=false
variable missing
any value other than exact string "true"
→ angelLogin() returns false before TOTP generation or network fetch.
```

Because `server.js` checks the `angelLogin()` result:

```text
angelLogin() false
→ no Angel One login request
→ no Angel One feed WebSocket start
→ no F&O history load
→ no fresh Angel One 429 reconnect loop on a new service boot
```

Fresh Render deployment evidence included:

```text
Angel One login skipped — ENABLE_ANGEL_ONE_WS is not true.
```

Current policy:

```text
Keep ENABLE_ANGEL_ONE_WS=false.
Do not enable it with the old reconnect implementation.
Do not use Angel One as an active F&O feed until it has a new
single-owner, rate-limit-aware, circuit-breaker-protected connector.
```

---

### 3.5 Crypto + Forex multi-timeframe analysis generator

A new analysis-only MTF module has been created and committed.

Commit:

```text
7d6fba6 Add analysis-only crypto and forex MTF snapshots
```

Committed source files:

```text
src/strategy/mtf/analysis_core.js
src/strategy/mtf/twelve_data_client.js
scripts/generate-crypto-forex-mtf-analysis.js
```

It covers:

```text
Symbols:
BTC/USD
ETH/USD
SOL/USD
BNB/USD
EUR/USD
XAU/USD

Timeframes:
1H
4H
1D
```

It calculates:

```text
Completed-candle filtering
Donchian(20) channel state
ATR(14)
SMA(200) context
LONG_BIAS / SHORT_BIAS / NEUTRAL
Freshness/data-quality state
Multi-timeframe alignment summary
```

The summary labels are:

```text
BULLISH_ALIGNMENT
BEARISH_ALIGNMENT
MIXED
NEUTRAL
```

All new MTF outputs explicitly contain:

```json
{
  "tier": "RESEARCH",
  "analysisOnly": true,
  "executionAllowed": false
}
```

The generator does not import or reference:

```text
Angel One
SmartAPI
F&O
Broker order modules
Order placement
Execution modules
Live capital
```

---

## 4. Multi-timeframe data design

### 4.1 Data source

The MTF generator requests separate OHLC series from Twelve Data:

```text
1H request:
interval=1h

4H request:
interval=4h

1D request:
interval=1day
```

The 1D series is not fabricated by resampling 1H or 4H candles.

The generator requests UTC-formatted timestamps and normalizes them before calculating indicators.

### 4.2 Completed-candle rule

The generator removes the currently forming candle when it belongs to the current time bucket:

```text
1H:
Current hourly candle is excluded.

4H:
Current 4-hour candle is excluded.

1D:
Current daily candle is excluded.
```

This is important because an in-progress candle can reverse before it closes and can create an unstable temporary breakout label.

### 4.3 MTF output files

Generated runtime files are written below:

```text
signals_live/analysis/
```

Examples:

```text
signals_live/analysis/BTC_USD_1h.json
signals_live/analysis/BTC_USD_4h.json
signals_live/analysis/BTC_USD_1d.json
signals_live/analysis/BTC_USD_summary.json

signals_live/analysis/EUR_USD_1h.json
signals_live/analysis/EUR_USD_4h.json
signals_live/analysis/EUR_USD_1d.json
signals_live/analysis/EUR_USD_summary.json

signals_live/analysis/_manifest.json
```

These are generated runtime artifacts and are ignored by the existing broad:

```text
signals_live/
```

Git ignore rule.

They must not be committed unless a specific future decision is made to preserve selected fixtures.

---

## 5. MTF generator verification

A local controlled generation run completed successfully:

```text
6 symbols × 3 timeframes
18 timeframe snapshots
6 summary files
Generator exit code: 0
Manifest failures: []
Data quality: OK for all generated snapshot outputs
```

At the time of the successful local run, all six summaries were:

```text
BTC/USD: NEUTRAL
ETH/USD: NEUTRAL
SOL/USD: NEUTRAL
BNB/USD: NEUTRAL
EUR/USD: NEUTRAL
XAU/USD: NEUTRAL
```

And all three timeframes for each symbol were:

```text
1H: NEUTRAL
4H: NEUTRAL
1D: NEUTRAL
```

This is a valid analysis result. It means the configured completed-candle Donchian(20) breakout rule found no current breakout. It is not a code failure.

---

## 6. Twelve Data rate-limit findings

The local generator test established the actual observed API limit:

```text
8 API credits per minute
```

A forced full refresh was too fast and triggered a provider response reporting that the current minute credit limit had been exceeded.

The safe run succeeded after using:

```text
MTF_REQUEST_GAP_MS=8500
```

and reusing cached snapshots.

The Twelve Data client was updated so that:

```text
HTTP 429
→ no automatic retry inside the same run
→ current symbol fails cleanly
→ prior valid snapshots remain available
→ failure is recorded in _manifest.json
→ a later controlled run can retry
```

This prevents one throttled request from becoming a retry burst.

### MTF rate-limit operating rules

```text
Do not run --force routinely.
Do not fetch data on every browser request.
Do not fetch all 18 data series every monitor cycle.
Do not run multiple generator processes simultaneously.
Do not use parallel requests with the current 8-credit/minute limit.
```

Recommended batch design:

```text
Hourly:
Refresh 1H snapshots only.
Maximum six symbol requests.

Every 4 hours:
Refresh 4H snapshots only.
Maximum six symbol requests.

Daily:
Refresh 1D snapshots only.
Maximum six symbol requests.

Spacing:
Use at least 8.5–10 seconds between outbound Twelve Data requests.
```

The dashboard should read generated snapshots; it should never call Twelve Data directly per user/browser connection.

---

## 7. Current deployed Render state

### Confirmed working

```text
Render service starts successfully.
Crypto candle updates are visible.
Crypto 1H Donchian calculation is visible.
Twelve Data connection for EUR/USD and XAU/USD is visible.
Angel One login guard is active.
Angel One 429 reconnect loop does not appear after fresh guarded startup.
```

Example fresh startup evidence:

```text
Angel One login skipped — ENABLE_ANGEL_ONE_WS is not true.
Twelve Data WS connected
Twelve Data → subscribed: EUR/USD, XAU/USD
[CRYPTO] BTC updated
[CRYPTO] ETH updated
[CRYPTO] SOL updated
[CRYPTO] BNB updated
```

### Current non-blocking warnings

#### Binance EMA overlay

```text
[EMA_CONFIRMATION] ... refresh failed: Unexpected Binance response
```

Status:

```text
Graceful failure.
Informational overlay may be N/A.
No impact on current Donchian logic.
No impact on 4H Crypto shadow workflow.
No impact on execution safety.
```

#### ETH/SOL daily signal-file alert

One earlier deployment/startup sequence showed:

```text
[MONITOR/SIGNAL_FILE_MISSING] ETH_USD_1d.json not found in signals_live/
```

Local inspection later confirmed:

```text
signals_live/ETH_USD_1d.json exists
signals_live/SOL_USD_1d.json exists
Writer and monitor filenames match
```

Current conclusion:

```text
Most likely a transient startup timing or runtime filesystem timing issue.
Not proven to be a permanent filename mismatch.
Do not rename files or create duplicate files without repeat evidence.
```

The next observation task is to check future monitor cycles. If the alert does not repeat, make no patch. If it repeats consistently, investigate Render runtime filesystem and startup ordering.

---

## 8. Git and commit history

Relevant known commits:

```text
947dfe4  freeze: crypto variant A/B OOS inputs and closed-trade reports
0f8d61b  feat: add fold-aware crypto 4H MTM carry-in accounting
592541d  Document crypto shadow handover and F&O data gates
68a1c65  Add informational daily EMA confirmation overlay
186c8cb  Ignore generated trading research artifacts
dbf99d0  Disable Angel One feed unless explicitly enabled
7d6fba6  Add analysis-only crypto and forex MTF snapshots
```

At the time this document was prepared, the remote branch had been synchronized through:

```text
dbf99d0
```

The MTF commit `7d6fba6` should be pushed separately after verifying local Git status.

### Important Git discipline

Never use:

```bash
git add .
git add -A
```

The working tree has contained unrelated local material, including:

```text
Modified MTM JSON reports
Many untracked research scripts
Patch-attempt backup files
Generated runtime outputs
```

Use explicit paths only.

---

## 9. Known local repository cleanup work

The following needs a separate, deliberate cleanup session later:

```text
1. Temporary patch backups:
   server.js.backup-before-angel-*
   src/angel/index.js.backup-before-angel-*
   src/strategy/mtf/*.backup-before-*
   scripts/*.backup-before-*

2. Modified tracked MTM files:
   data/backtest-results/mtm-crypto-asset-4h.json
   data/backtest-results/mtm-crypto-event-ledger.json
   data/backtest-results/mtm-crypto-reconciliation.json

3. Many untracked research/shadow scripts.
```

For each tracked MTM file, decide deliberately:

```text
Option A:
Commit it if it is an intentional reproducible research fixture.

Option B:
Restore it if it is accidental regenerated output.

Option C:
Remove it from Git tracking in a dedicated cleanup commit,
while retaining it locally as ignored generated data.
```

Do not rewrite Git history unless there is a serious and intentional need, such as sensitive-data removal or repository-size remediation.

---

## 10. Current safety boundary

```text
Market analysis:
Enabled for Crypto.
Forex data path is active; MTF analysis generator is local-ready.

Crypto 4H:
Shadow/research mode.
Human review required.

F&O:
Deferred and disabled by default.

Angel One:
Disabled unless ENABLE_ANGEL_ONE_WS is exactly true.

Automatic paper trading:
Disabled.

Order routing:
Disabled.

Execution:
Disabled.

Live capital:
Not approved.

MTF generator:
Research only.
analysisOnly=true.
executionAllowed=false.
```

---

## 11. What should happen next

### Immediate next steps

1. Push the latest MTF source commit:

```bash
git push
```

Expected latest commit:

```text
7d6fba6 Add analysis-only crypto and forex MTF snapshots
```

2. Continue observing Render logs for the next monitor cycles.

Pass conditions:

```text
No new Angel One 429 lines.
No repeated ETH/SOL SIGNAL_FILE_MISSING alerts.
Crypto updates continue.
Monitor reaches "Cycle complete".
```

3. Do not deploy the MTF generator yet.

The generator has not been added to `server.js`, scheduler code, API routes, or dashboard. This is intentional until rate-controlled integration is ready.

---

### Next development milestone: MTF visibility

Build one controlled integration batch containing:

```text
A server-side MTF scheduler
A single-process overlap lock
Rate-budget-aware request sequencing
Snapshot-only API endpoint
Dashboard 1H / 4H / 1D table
Overall alignment display
Freshness and data-quality display
No browser-side provider fetches
No F&O or Angel One changes
No trading/execution feature
```

Suggested dashboard columns:

```text
Symbol
1H bias
4H bias
1D bias
Overall alignment
Data quality
Last closed candle UTC
Updated UTC
Research-only status
```

Suggested labels:

```text
LONG_BIAS
SHORT_BIAS
NEUTRAL
BULLISH_ALIGNMENT
BEARISH_ALIGNMENT
MIXED
STALE
INSUFFICIENT_HISTORY
```

---

### Forex research validation

Before treating Forex labels as a proven strategy, conduct market-specific research:

```text
Collect adequate 1H / 4H / 1D historical OHLC data.
Define Forex spread/slippage assumptions.
Handle weekday sessions, weekend gaps, and provider timestamp behavior.
Backtest the chosen Donchian/ATR/SMA rules.
Run out-of-sample / walk-forward checks.
Review results per pair.
Run a shadow-observation period.
```

Crypto evidence does not automatically validate Forex performance.

---

### F&O research future path

F&O should be restarted only as a contract-aware analysis project:

```text
Use real futures contract data.
Include contract symbol, expiry, OHLC, volume, OI, lot size,
rollover logic, settlement/reference fields, timezone, and session rules.
Start with one liquid instrument, for example a documented NIFTY futures contract.
Build read-only historical analysis before adding any persistent WebSocket.
Implement a single-owner connector with exponential backoff, jitter,
429 handling, and a circuit breaker.
Validate OOS separately.
```

Do not use Yahoo index/spot/equity data as a substitute for derivative-contract data.

Do not re-enable:

```text
ENABLE_ANGEL_ONE_WS=true
```

until the connector and data-validation work are complete.

---

## 12. Commands for safe MTF use

### One-time manual local MTF refresh

Use only when deliberate analysis refresh is needed:

```bash
MTF_REQUEST_GAP_MS=8500 \
node scripts/generate-crypto-forex-mtf-analysis.js
```

Avoid `--force` in routine use because it bypasses cache TTLs and can exceed the observed Twelve Data rate limit.

### Check generated summaries

```bash
for f in signals_live/analysis/*_summary.json; do
  [ -f "$f" ] || continue
  node --input-type=module -e \
    "import fs from 'fs'; const x=JSON.parse(fs.readFileSync('$f','utf8')); const t=x.timeframes; console.log([x.meta.key, x.summary.alignment, '1H='+t['1h'].bias, '4H='+t['4h'].bias, '1D='+t['1d'].bias, 'quality='+x.meta.dataQuality].join(' | '));"
done
```

### Check latest manifest failures

```bash
node --input-type=module -e \
  "import fs from 'fs'; const x=JSON.parse(fs.readFileSync('signals_live/analysis/_manifest.json','utf8')); console.log(JSON.stringify(x.failures,null,2));"
```

Expected healthy result:

```json
[]
```

---

## 13. Final status summary

```text
Crypto 4H shadow workflow:
Built, verified, human-gated, no execution.

Crypto EMA overlay:
Committed, informational-only, may be N/A on Render because Binance fails there.

Angel One / F&O:
Safely disabled by environment guard.
429 reconnect loop mitigated after deploy.

Crypto + Forex MTF:
1H, 4H, 1D generator built and locally verified.
Six symbols complete in successful local run.
Research tier only.
No execution.

Twelve Data:
Working with controlled pacing.
Observed limit: 8 credits per minute.

Dashboard MTF display:
Not yet integrated.

MTF production scheduler/API:
Not yet integrated.

Forex validation:
Not yet completed.

F&O contract-aware research:
Not yet started.

Automatic trading:
Disabled.

Live capital:
Not approved.
```


---

## 14. NIFTY offline research and source-admission milestone

**Milestone status:** Complete and validated locally
**Operating mode:** Offline-only, research-only, read-only downstream consumption
**Trading approval:** Not approved
**Last verified:** 2026-09-08

### 14.1 Purpose and scope

A separate offline NIFTY research-control system has been added. It is intentionally isolated from broker, market-streaming, order, and execution code.

Its purpose is to:

```text
Validate deterministic offline NIFTY research artifacts
Maintain independent daily-reference research
Classify a frozen third-party intraday minute fixture
Provide a generic research-source admission framework
Expose generated audit artifacts through a local read-only dashboard/API
Preserve source-admission decisions without downstream reinterpretation
```

It does not:

```text
Fetch live market data
Use a broker API
Use Angel One
Use WebSocket market streaming
Place orders
Create trading signals for execution
Approve live or paper trading
Authorize capital deployment
```

### 14.2 Official NIFTY daily reference

The official daily-reference pipeline is independent from the third-party minute fixture.

Latest validated daily-reference state:

```text
Normalized daily rows: 666
Daily coverage: 2024-01-01 through 2026-09-07
Daily snapshot regression: PASS
Scenarios: 3/3 passed
Differences: 0
```

Validated scenarios:

```text
LATEST_OFFICIAL_DAILY_DATA_END
HISTORICAL_CUTOFF_2025
PRE_SMA200_HISTORY
```

The pre-SMA200 scenario correctly returns:

```text
bias: INSUFFICIENT_DATA
SMA200: null
```

This daily reference is suitable only for independent 1D research within its actual recorded coverage. It is not a live-data claim.

### 14.3 Frozen NIFTY minute fixture

The local NIFTY minute CSV is a frozen third-party historical research fixture. It is not a current or independently reconciled intraday source.

Current governance state:

```text
Structural validation:             PASS
Fixture provenance SHA-256:        PASS
Reference reconciliation:          FAIL / REVIEW
Freshness:                         FAIL / STALE
Current intraday eligibility:      false
Current intraday decision:         BLOCKED
```

The generic source-admission artifact for the frozen fixture currently records:

```text
decision:                          BLOCKED
terminalReason:                    SESSION_BLOCKED
approvedForResearchSource:         false
approvedForTrading:                false
```

Important interpretation:

```text
A PASS for the framework means controls are working correctly.
It does not mean the frozen minute fixture is trusted/current.
It does not mean NIFTY intraday research is current-context eligible.
It does not mean trading is permitted.
```

### 14.4 Generic source-admission framework

A generic, policy-driven offline source-admission framework now exists for future candidate intraday CSV datasets.

Architecture:

```text
Candidate CSV + candidate profile + versioned policy + independent reference
                                  ↓
                  Generic source-admission validator
                                  ↓
                    Serialized admission audit artifact
                                  ↓
                      Independent artifact verifier
                                  ↓
                    Local read-only API/dashboard
```

The validator is the only component allowed to decide admission. The artifact records that decision. The verifier, API, and dashboard only consume or verify the serialized artifact.

Required downstream invariant:

```text
validator decision
        ==
serialized admission artifact decision
        ==
verifier-observed decision
        ==
GET /api/admission decision
        ==
dashboard-rendered decision
```

No downstream layer may transform:

```text
BLOCKED                       → REVIEW
REVIEW                        → APPROVED_FOR_RESEARCH_SOURCE
APPROVED_FOR_RESEARCH_SOURCE  → trading approval
```

Decision states:

```text
APPROVED_FOR_RESEARCH_SOURCE
→ approved only as a research data source under the recorded policy and coverage.

REVIEW
→ not admitted; requires human investigation.

BLOCKED
→ not admitted; a required integrity, structural, session, provenance, or policy control failed.
```

`APPROVED_FOR_RESEARCH_SOURCE` never means trading approval.

### 14.5 Admission decision precedence

Admission precedence is explicit and fixed:

```text
Missing/corrupt required artifact
        ↓
BLOCKED

Provenance or SHA-256 failure
        ↓
BLOCKED

Required schema, structural, timestamp, or session failure
        ↓
BLOCKED

Reference reconciliation failure
        ↓
REVIEW or BLOCKED according to the versioned policy

Freshness failure
        ↓
REVIEW or BLOCKED according to the versioned policy

All required gates pass
        ↓
APPROVED_FOR_RESEARCH_SOURCE
```

A lower-severity result cannot mask a higher-severity integrity or structural failure.

### 14.6 Admission regression coverage

The admission regression suite passed 5/5 deterministic cases:

```text
SYNTHETIC_APPROVED
→ APPROVED_FOR_RESEARCH_SOURCE
→ framework capability test only
→ never a real-world source approval

SYNTHETIC_REVIEW
→ REVIEW
→ controlled reference-reconciliation mismatch

SYNTHETIC_BLOCKED_FRESHNESS
→ BLOCKED
→ terminal reason: FRESHNESS_BLOCKED

SYNTHETIC_BLOCKED_HASH_MISMATCH
→ BLOCKED
→ terminal reason: PROVENANCE_BLOCKED

FROZEN_NIFTY_FIXTURE_EXPECTED_BLOCKED
→ BLOCKED
→ terminal reason: SESSION_BLOCKED
```

Latest regression result:

```text
SOURCE ADMISSION REGRESSION: PASS
Cases: 5/5 passed
Repeatability: PASS
```

### 14.7 Local dashboard and API

A local-only read-only dashboard is available:

```text
Start command:
node dashboard/server.js

Local URL:
http://127.0.0.1:8787
```

The server is constrained to local loopback binding by default:

```text
127.0.0.1
localhost
::1
```

It rejects non-local host settings.

Read-only endpoints:

```text
GET /api/health
GET /api/status
GET /api/manifest
GET /api/daily
GET /api/intraday
GET /api/governance
GET /api/admission
```

The `/api/admission` endpoint transports the serialized:

```text
data/india-analysis/nifty-minute-source-admission.json
```

It does not calculate a new policy outcome.

Dashboard/API guarantees:

```text
Local-only binding: PASS
Read-only API surface: PASS
No-store API cache policy: PASS
Missing/corrupt/inconsistent artifacts: fail closed with HTTP 503
Unsupported API route: HTTP 404
Non-GET request: HTTP 405
Artifact → API fidelity: PASS
API → dashboard render-only contract: PASS
End-to-end admission artifact fidelity: PASS
```

### 14.8 Permanent NIFTY safety boundary

The following boundary is machine-readable in admission artifacts and must remain unchanged:

```text
researchOnly:                    true
approvedForTrading:              false
brokerConnectivityAllowed:       false
websocketAllowed:                false
ordersAllowed:                   false
executionAllowed:                false
humanReviewRequired:             true
```

Equivalent operational interpretation:

```text
Broker:      DISABLED
WebSocket:   DISABLED
Orders:      DISABLED
Execution:   DISABLED
Trading:     NOT APPROVED
```

### 14.9 NIFTY validation commands

Run these commands after any NIFTY offline-suite, admission-framework, or dashboard change:

```bash
cd ~/projects/trishika-trading

node scripts/run-nifty-offline-validation-suite.js

node scripts/run-source-admission.js \
  --profile admission/candidate-profiles/nifty-frozen-minute-fixture.json \
  --output data/india-analysis/nifty-minute-source-admission.json

node scripts/run-source-admission-regression.js

node scripts/verify-source-admission-framework.js

node scripts/verify-nifty-offline-dashboard.js

node scripts/run-nifty-offline-dashboard-self-test.js

node scripts/run-source-admission-dashboard-self-test.js
```

Expected high-level final state:

```text
OFFLINE NIFTY VALIDATION SUITE: PASS
SOURCE ADMISSION REGRESSION: PASS
FROZEN NIFTY FIXTURE: BLOCKED (EXPECTED)
SOURCE_ADMISSION_FRAMEWORK: PASS
```

If any command returns `ERROR:` or `FAIL`, stop. Treat the affected dashboard/admission state as unverified until the failure is investigated and corrected. Never infer a favourable admission state from partial results.

---

## 15. Documentation and next-session handover

For the latest NIFTY offline-research milestone, use:

```text
docs/NEXT_SESSION_SUMMARY.md
docs/OFFLINE_NIFTY_RESEARCH_USER_MANUAL.md
```

These documents summarize current controls, routine commands, dashboard operation, admission-state interpretation, and safe future candidate onboarding.
