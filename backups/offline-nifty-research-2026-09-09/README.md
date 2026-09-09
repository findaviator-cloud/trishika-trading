# Offline NIFTY Research Backup

**Backup date:** 2026-09-09
**Purpose:** Source/documentation backup of the offline NIFTY research, generic source-admission, and local read-only dashboard work.

## Boundary

```text
OFFLINE ONLY
RESEARCH ONLY
LOCAL-ONLY DASHBOARD
READ-ONLY API
FAIL CLOSED
```

```text
Broker connectivity: DISABLED
WebSocket: DISABLED
Orders: DISABLED
Execution: DISABLED
Trading approval: FALSE
```

## Current canonical NIFTY intraday state

```text
Frozen minute fixture:
decision: BLOCKED
terminalReason: SESSION_BLOCKED
approvedForResearchSource: false
approvedForTrading: false
```

The official daily NIFTY reference is separate and available only for offline 1D research within recorded coverage.

## Included

```text
- Documentation and handover
- Offline NIFTY daily/intraday validation scripts
- Generic source-admission policy, profiles, and synthetic fixtures
- Source-admission validator, verifier, and regression scripts
- Local read-only dashboard source
- NIFTY MTF Phase 1 source
```

## Excluded deliberately

```text
- .env and secrets
- node_modules
- broker/Angel One code
- live market/API integrations
- orders/execution code
- raw minute CSV data
- generated runtime/analysis artifacts
- existing project-level server.js and production trading source
- local .backup_* directories
```

## Restore/use

Copy reviewed files back into the intended project locations only after deliberate review. Do not treat this backup as trading approval.
