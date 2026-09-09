# Offline NIFTY Research System — User Manual

**System mode:** Offline-only, research-only, local-only, read-only downstream
**Trading status:** Not approved
**Audience:** Project operator/reviewer

---

## 1. What this system does

This system validates and displays offline NIFTY research artifacts.

It provides:

```text
Official daily-reference research checks
Frozen intraday-fixture governance checks
Generic CSV source-admission validation
SHA-256 provenance verification
Deterministic regression tests
A local read-only dashboard and JSON API
```

It does not provide:

```text
Live market data
Broker login
Angel One connection
WebSocket market streaming
Order placement
Portfolio actions
Trade execution
Automatic paper trading
Live-capital trading
```

A passing check means the offline controls worked as designed. It does not mean a source is current, trusted, or trading-approved.

---

## 2. Important meanings

### PASS

`PASS` means a validation, regression, integrity, or transport/render check succeeded.

Example:

```text
SOURCE ADMISSION FRAMEWORK: PASS
```

Meaning:

```text
The policy, validator, artifacts, verifier, API, and dashboard checks are behaving consistently.
```

It does not mean:

```text
Trading is allowed.
A frozen intraday source is current.
A blocked source has become trusted.
```

### APPROVED_FOR_RESEARCH_SOURCE

This result applies only to a candidate source that passes the configured research-admission policy.

```text
APPROVED_FOR_RESEARCH_SOURCE
≠
Approved for trading
```

Even this state must keep:

```text
approvedForTrading: false
brokerConnectivityAllowed: false
websocketAllowed: false
ordersAllowed: false
executionAllowed: false
```

The existing clean synthetic fixture uses this state only to test framework capability. It is not real market-source approval.

### REVIEW

`REVIEW` means the candidate is not admitted and requires investigation.

A typical reason is a reference-reconciliation issue where the policy maps the failure to review rather than terminal block.

### BLOCKED

`BLOCKED` means the candidate is not admitted. Causes can include:

```text
Missing/corrupt artifact
SHA-256/provenance mismatch
Schema failure
Structural failure
Timestamp failure
Trading-session failure
Freshness failure
Policy-defined reference-reconciliation failure
```

The current frozen NIFTY fixture is expected to remain:

```text
decision: BLOCKED
terminalReason: SESSION_BLOCKED
```

---

## 3. Safety boundary

These values must remain unchanged:

```text
researchOnly:                    true
approvedForTrading:              false
brokerConnectivityAllowed:       false
websocketAllowed:                false
ordersAllowed:                   false
executionAllowed:                false
humanReviewRequired:             true
```

Practical meaning:

```text
Broker:      DISABLED
WebSocket:   DISABLED
Orders:      DISABLED
Execution:   DISABLED
Trading:     NOT APPROVED
```

Never interpret a research-source admission as authority to trade.

---

## 4. Start the dashboard

Open a terminal in the project directory:

```bash
cd ~/projects/trishika-trading
node dashboard/server.js
```

When the startup message says `READY`, open this address in a browser on the same machine:

```text
http://127.0.0.1:8787
```

The dashboard is intentionally local-only. It binds to loopback by default and must not be exposed to public networks.

To stop the server:

```text
Press Ctrl+C in the terminal running dashboard/server.js.
```

---

## 5. Dashboard interpretation

The dashboard displays previously generated local artifacts. It does not decide policy.

Pay special attention to:

```text
Suite
Daily Reference
Intraday Fixture
Current Eligibility
Reconciliation
Freshness
Structural Gate
Fixture Decision
Hard-block reason
Source admission artifact
Provenance and SHA-256
```

For the current frozen NIFTY fixture, expected display state is:

```text
Decision:                         BLOCKED
Terminal reason:                  SESSION_BLOCKED
Research admission:               FALSE
Trading approval:                 FALSE

Reference reconciliation:         FAIL
Freshness:                        FAIL
Current eligibility:              BLOCKED
```

If the dashboard reports `ARTIFACT_INTEGRITY_BLOCKED`, do not rely on the UI. Run the full verification workflow.

---

## 6. Local API endpoints

All endpoints are read-only and available only through the local dashboard server.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Confirms required artifacts are available and internally consistent |
| `GET /api/status` | Displays consolidated offline research status |
| `GET /api/manifest` | Displays source inventory, hashes, coverage, and source separation |
| `GET /api/daily` | Displays official daily-reference research information |
| `GET /api/intraday` | Displays frozen intraday fixture classification and hard-block context |
| `GET /api/governance` | Displays safety and governance artifacts |
| `GET /api/admission` | Transports the serialized NIFTY source-admission artifact |

Expected behavior:

```text
Healthy artifact set:
GET /api/health → HTTP 200

Missing/corrupt/inconsistent artifact:
GET /api/health and other API routes → HTTP 503 ARTIFACT_INTEGRITY_BLOCKED

Unknown route:
HTTP 404

POST/PUT/DELETE or another non-GET method:
HTTP 405
```

`GET /api/admission` is a transport endpoint. It does not recompute admission, eligibility, freshness, reconciliation, or provenance.

---

## 7. Run full validation

Run the following commands from the project root after changes to the NIFTY offline suite, admission framework, dashboard, policies, profiles, or fixtures.

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

Expected success indicators:

```text
OFFLINE NIFTY VALIDATION SUITE: PASS
SOURCE ADMISSION REGRESSION: PASS
Cases: 5/5 passed
Repeatability: PASS

PASS: FROZEN_NIFTY_FIXTURE_BLOCKED_EXPECTED
PASS: END_TO_END_ADMISSION_ARTIFACT_FIDELITY
SOURCE_ADMISSION_FRAMEWORK: PASS
```

If any command prints `ERROR:` or `FAIL`:

1. Stop the workflow.
2. Do not use the dashboard result as reliable.
3. Do not edit raw CSV evidence to force a pass.
4. Preserve the failure output and affected artifacts.
5. Identify whether the failure is in a profile, policy, fixture, validator, artifact, dashboard route, or render contract.
6. Apply a deliberate backup-first correction.
7. Re-run the entire validation sequence.

Do not “fix” a failure by manually changing an admission decision inside the generated artifact.

---

## 8. Source-admission workflow

The admission framework processes this chain:

```text
Candidate CSV
+ Candidate profile
+ Versioned admission policy
+ Independent reference CSV
        ↓
Generic validator
        ↓
Serialized admission audit artifact
        ↓
Independent verifier
        ↓
Read-only API
        ↓
Render-only dashboard
```

The validator alone creates the decision. Downstream stages may not change it.

Admission precedence is:

```text
Missing/corrupt required artifact
→ BLOCKED

Provenance/SHA-256 failure
→ BLOCKED

Schema/structure/timestamp/session failure
→ BLOCKED

Reference reconciliation failure
→ REVIEW or BLOCKED according to policy

Freshness failure
→ REVIEW or BLOCKED according to policy

All required checks pass
→ APPROVED_FOR_RESEARCH_SOURCE
```

A lower-priority result cannot override a higher-priority integrity or structural failure.

---

## 9. Add a future candidate CSV

Do this only when you have a legitimate candidate dataset and a deliberate research-admission scope.

### Step 1: Preserve raw data

Place the candidate CSV in a clearly named local input/fixture location. Do not alter its historical rows to make it pass validation.

### Step 2: Create a candidate profile

Create a new JSON profile under:

```text
admission/candidate-profiles/
```

The profile needs:

```text
profileId
candidateType
sourceTier
candidatePath
referencePath
evaluationAsOf
expectedSha256
expectedDecision
expectedApprovedForResearchSource
notes
```

### Step 3: Bind SHA-256

Calculate the candidate hash:

```bash
sha256sum path/to/candidate.csv
```

Copy the exact resulting SHA-256 into `expectedSha256` in the profile.

A later candidate modification must cause a provenance mismatch and `BLOCKED` outcome until the profile is deliberately updated after review.

### Step 4: Use an independent reference

The `referencePath` must point to an independent daily reference CSV. Do not use the candidate’s own aggregates as its reference.

### Step 5: Run admission

Example:

```bash
node scripts/run-source-admission.js \
  --profile admission/candidate-profiles/your-candidate.json \
  --output data/india-analysis/your-candidate-source-admission.json
```

### Step 6: Verify generated artifact

```bash
node scripts/verify-source-admission.js \
  --artifact data/india-analysis/your-candidate-source-admission.json
```

### Step 7: Interpret correctly

```text
APPROVED_FOR_RESEARCH_SOURCE
→ source may be used only for recorded research scope.

REVIEW
→ do not use as admitted source; investigate.

BLOCKED
→ do not use as admitted source; fix the input/policy/profile issue only through deliberate review.
```

Do not manually edit the output artifact, and do not treat an approved research source as trading approval.

### Step 8: Dashboard integration

The current dashboard route exposes the canonical frozen NIFTY admission artifact:

```text
data/india-analysis/nifty-minute-source-admission.json
```

Do not replace this canonical artifact with a new candidate without an explicit design decision, regression coverage, and dashboard-fidelity test update.

---

## 10. Important files

```text
Admission policy:
admission/source-admission-policy.json

Candidate profiles:
admission/candidate-profiles/

Synthetic regression fixtures:
admission/fixtures/

Canonical frozen NIFTY admission artifact:
data/india-analysis/nifty-minute-source-admission.json

Admission regression audit:
data/india-analysis/source-admission-regression-audit.json

Official daily-reference regression audit:
data/india-analysis/nifty-daily-reference-regression-audit.json

Intraday governance audit:
data/india-analysis/nifty-data-governance-regression-audit.json

Dashboard server:
dashboard/server.js

Dashboard API route:
dashboard/routes/admission.js
```

---

## 11. Routine operating rules

```text
Use the dashboard only after passing validation.
Treat generated artifacts as evidence, not editable configuration.
Use backup-first changes.
Keep policy/profile versions explicit.
Keep independent reference data independent.
Never override BLOCKED/REVIEW in the dashboard.
Do not enable broker/WebSocket/orders/execution in this system.
Do not expose the dashboard beyond localhost.
Do not use partial PASS output after a later failure.
```

## 12. Troubleshooting

| Symptom | Meaning | Safe response |
|---|---|---|
| `ARTIFACT_INTEGRITY_BLOCKED` | Required JSON is missing, corrupt, or inconsistent | Stop dashboard use; run full validation and inspect the first failure |
| `PROVENANCE_BLOCKED` | Candidate file SHA-256 differs from profile | Confirm whether candidate changed; do not alter expected hash without deliberate review |
| `SESSION_BLOCKED` | Candidate violates configured session validation | Inspect timestamps/timezone/session policy; do not relabel decision manually |
| `FRESHNESS_BLOCKED` | Candidate is older than policy permits | Obtain/review a newer candidate; do not mark stale data as fresh |
| `REFERENCERECONCILIATION_REVIEW` | Candidate does not meet independent-reference tolerance | Investigate source/reference mismatch; do not promote it to approved |
| Dashboard does not start | Local server failure or port conflict | Stop prior local dashboard process, review server output, then rerun checks |
| A self-test fails | API/UI may no longer faithfully consume artifacts | Treat display as unverified; correct code with backup-first workflow and rerun all checks |

---

## 13. Core principle

```text
Validator decides.
Artifact records.
Verifier checks.
API transports.
Dashboard renders.
```

The system is built to preserve evidence and safety boundaries—not to create a path from research data to execution.
