# Trishika Trading — Crypto 4H Shadow and F&O Handover

## Purpose

This document records the locally verified operational status of the crypto
4H shadow workflow, the informational-only boundary for the existing 1H
dashboard EMA field, and the deferred status of F&O and Forex work.

This is documentation only. It does not modify strategy logic, signals,
paper trades, orders, execution, live capital, server configuration, or
Render deployment behavior.

Nothing in this document authorizes automatic trading, order routing, broker
API execution, or use of live capital.

---

## Current status

```text
Crypto 4H Shadow Architecture: VALIDATED / LOCK-READY
Crypto research: ENABLED
Crypto 4H observation: ENABLED
Crypto human decision: REQUIRED
Crypto manual paper ledger: ENABLED
Crypto automatic paper trading: DISABLED
Crypto order routing: DISABLED
Crypto execution: DISABLED
Crypto live capital: NOT APPROVED

1H Dashboard EMA: INFORMATIONAL ONLY
F&O: DEFERRED — REAL CONTRACT-AWARE DATA REQUIRED
Forex: DEFERRED
```

---

## 1H and 4H boundary

The existing 1H dashboard EMA field is informational context only and is not
a validated 4H trading-decision gate.

The crypto 4H shadow system is the research-aligned workflow for:

```text
Signal observation
Human decision-making
Manual paper-trade recording
No automatic execution
No live capital
```

The 1H dashboard EMA field must never:

```text
Create a human decision
Create a paper trade
Trigger an order
Call execution code
Be described as a validated 4H entry or exit gate
```

Future paper-trade decisions must reference a 4H shadow observation key, not
the 1H dashboard informational field.

---

## Latest verified crypto reports

The following local reports were verified as present:

| Validation | Result | Generated UTC |
|---|---:|---|
| 4H shadow parity | PASS — 57/57 | 2026-09-06T15:36:35.903Z |
| Live-shadow freshness and boundary validation | PASS — 37/37 | 2026-09-07T04:57:58.840Z |
| Human decision audit | PASS — 4/4 observations, 4/4 decisions, 36/36 checks | 2026-09-07T05:04:49.616Z |
| Manual paper-trade ledger | PASS — 1/1 checks; 0 events; 0 open; 0 closed | 2026-09-07T05:04:49.718Z |
| Lock-readiness audit | SHADOW_INFRASTRUCTURE_READY — 6/6 | 2026-09-07T05:04:49.805Z |

The readiness audit states:

```text
LiveCapital=NOT_APPROVED
AutomatedExecution=NOT_APPROVED
```

These are workflow, data-integrity, and safety-validation results. They are
not profitability guarantees, live-deployment approval, or approval to use
live capital.

---

## Crypto asset policy

| Asset | Shadow observation | Human ACCEPT | Manual paper trade |
|---|---:|---:|---:|
| BTC | Allowed | Only after valid directional 4H signal, confirmation, and manual review | Allowed |
| ETH | Allowed with tail-risk caution | Only after valid directional 4H signal, confirmation, and manual review | Allowed |
| BNB | Allowed with tight-risk/cost-fragility caution | Only after valid directional 4H signal, confirmation, and manual review | Allowed |
| SOL | Observation/audit only | Never allowed | Never allowed |

Mandatory rules:

```text
NEUTRAL observation -> normally record IGNORE.
Every new 4H observation requires IGNORE, REJECT, or ACCEPT plus a reason.
ACCEPT requires a directional LONG or SHORT observation.
ACCEPT is forbidden for SOL and UNSUPPORTED tier.
No paper trade is created automatically.
No order function may be called.
No execution function may be called.
No live capital may be used.
```

---

## Crypto normal operation

Run after a completed UTC 4H boundary:

```text
00:00 UTC
04:00 UTC
08:00 UTC
12:00 UTC
16:00 UTC
20:00 UTC
```

Capture cycle:

```bash
cd ~/projects/trishika-trading && \
node scripts/run-crypto-4h-shadow-operations.js \
  | tee data/backtest-results/crypto-4h-shadow-operations-console.txt
```

The operations runner may stop at the human-decision audit if new observations
have not yet received human decisions. This is expected and safe.

Record a human decision for each new observation key:

```bash
cd ~/projects/trishika-trading && \
node scripts/record-crypto-4h-shadow-human-decision.js \
  --key "BTC|<CANDLE_CLOSE_UTC>" \
  --decision IGNORE \
  --reason "NEUTRAL 4H shadow signal; no paper action."
```

After recording decisions, run:

```bash
cd ~/projects/trishika-trading && \
node scripts/verify-crypto-4h-shadow-human-decisions.js && \
node scripts/verify-crypto-4h-shadow-paper-trades.js && \
node scripts/audit-crypto-4h-shadow-readiness.js
```

A manual paper-trade record is possible only for an eligible BTC, ETH, or BNB
directional observation after explicit human ACCEPT. It is never automatic.

---

## Decision-audit safety patch

The decision-audit aggregate no-action checks were corrected so that only an
explicit boolean true represents an unsafe action:

```js
row.paperTradeCreated === true
row.executionCalled === true
row.orderFunctionsCalled === true
```

This preserves the distinction:

```text
Missing human decision:
- Decision coverage is pending or fails.

Explicit automatic paper-trade/order/execution action:
- The corresponding safety check fails.
```

The pre-patch audit file was retained:

```text
scripts/verify-crypto-4h-shadow-human-decisions.v1-before-missing-safety-normalization.js
```

---

## F&O status

F&O is not an active signal, paper-trade, order-routing, execution, or
live-capital workflow.

The locally verified experimental underlying-index context report was:

```text
Status: N_A
Evidence tier: EXPERIMENTAL_INDEX_CONTEXT
Market data class: UNDERLYING_INDEX_DAILY
Requested instruments: 2
Available contexts: 0
Unavailable contexts: 2
Trading decision eligible: false
Paper trade eligible: false
Execution eligible: false
Live capital eligible: false
```

The relevant script is:

```text
scripts/generate-nse-index-experimental-context.js
```

This result is not an F&O futures signal. It must not be displayed as a trade
recommendation, paper-trade trigger, or validated confirmation.

Current state:

```text
F&O / NSE Index Context: N/A
Classification: EXPERIMENTAL_INDEX_CONTEXT
Trading decision: NOT ELIGIBLE
Paper trade: NOT ELIGIBLE
Execution: NOT ELIGIBLE
Live capital: NOT ELIGIBLE
```

---

## F&O data readiness

Locally confirmed F&O-related scripts:

```text
scripts/generate-nse-index-experimental-context.js
scripts/validate-nse-futures-data-intake-manifest.js
scripts/reconcile-nse-futures-reference-data.js
```

The following provider-data audit script was not present during local
verification and must not be claimed as available until it is created and
syntax-checked:

```text
scripts/audit-nse-futures-data-source.js
```

Current F&O evidence state:

```text
Reference reconciliation: N_A
Reason: provider CSV and reference CSV were absent at the time of the run.

Data-intake manifest validation: FAIL — 23/24 checks passed.
Reason: template placeholder dates are not real dates.

Provider CSV audit report: absent.
Reason: no locally verified provider-data audit script/report is present.
```

Do not use dummy rows, guessed dates, fake checksums, or underlying-index
prices relabeled as futures data to force these checks to pass.

---

## F&O resumption requirements

F&O research may resume only after obtaining real, contract-specific NIFTY
futures data for one specific actual expiry.

Minimum required fields:

```text
timestamp
underlying
instrumentType
tradableSymbol
expiryDate
open
high
low
close
volume
openInterest
lotSize
settlementPrice
source
timezone
```

Recommended first scope:

```text
Exchange: NSE
Segment: NFO
Underlying: NIFTY
Instrument: FUTIDX / index future
Timeframe: Daily EOD
Contract: one specific actual expiry
Sample size: preferably 20-60 actual trading days
Timezone: Asia/Kolkata
```

No API keys, tokens, client identifiers, broker credentials, account numbers,
or personal information may be stored in CSV files, manifests, Git commits,
or reports.

Before any F&O strategy or shadow workflow, real provider data and an
independent reference data sample must be reconciled for the same contract
and date range using a separately verified read-only provider-data audit and
reference-reconciliation process.

---

## Forex status

Forex is a separate deferred research project:

```text
Forex research: NOT ACTIVE
Forex shadow workflow: NOT BUILT
Forex paper trading: DISABLED
Forex execution: DISABLED
Forex live capital: NOT APPROVED
```

Forex does not inherit crypto validation or any future F&O approval. It
requires its own data source, session/calendar handling, bid-ask/spread
model, out-of-sample evidence, and shadow validation.

---

## Freeze rule

Do not add new trading logic, automatic decisions, automatic paper trades,
order routing, execution integration, or live-capital deployment under the
current scope.

Immediate work is calendar-time crypto shadow evidence collection. F&O work
is blocked until real contract-aware data exists and a separately verified,
read-only provider-data audit plus reference-reconciliation workflow exists.
