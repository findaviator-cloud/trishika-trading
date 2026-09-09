'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveReadiness,
  STATUS_READY,
  STATUS_BLOCKED
} = require('../dashboard/lib/nifty-mtf-admission-guard.cjs');

const ROOT = path.resolve(__dirname, '..');

const fixtures = {
  blocked: path.join(ROOT, 'admission/fixtures/blocked.json'),
  review: path.join(ROOT, 'admission/fixtures/review.json'),
  approved: path.join(ROOT, 'admission/fixtures/approved-synthetic.json'),
  malformed: path.join(ROOT, 'admission/fixtures/malformed.json'),
  inconsistentTrading: path.join(
    ROOT,
    'admission/fixtures/inconsistent-trading.json'
  ),
  inconsistentResearch: path.join(
    ROOT,
    'admission/fixtures/inconsistent-research-flag.json'
  ),
  missing: path.join(
    ROOT,
    'admission/fixtures/does-not-exist.json'
  )
};

const protectedFiles = [
  path.join(ROOT, 'data/india-analysis/mtf/NIFTY_1h.json'),
  path.join(ROOT, 'data/india-analysis/mtf/NIFTY_4h.json')
];

function fingerprint(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false };
  }

  const bytes = fs.readFileSync(filePath);

  return {
    exists: true,
    size: bytes.length,
    sha256: crypto
      .createHash('sha256')
      .update(bytes)
      .digest('hex')
  };
}

function snapshotProtectedFiles() {
  return Object.fromEntries(
    protectedFiles.map((filePath) => [
      filePath,
      fingerprint(filePath)
    ])
  );
}

function expectBlocked(filePath, reason) {
  const result = resolveReadiness({
    artifactPath: filePath
  });

  assert.equal(result.httpStatus, 409);
  assert.equal(result.body.status, STATUS_BLOCKED);
  assert.equal(result.body.approvedForResearchSource, false);
  assert.equal(result.body.approvedForTrading, false);
  assert.equal(result.body.readinessOnly, true);
  assert.equal(result.body.reason, reason);
}

function expectReady(filePath) {
  const result = resolveReadiness({
    artifactPath: filePath
  });

  assert.equal(result.httpStatus, 200);

  assert.deepEqual(result.body, {
    status: STATUS_READY,
    approvedForResearchSource: true,
    approvedForTrading: false,
    readinessOnly: true
  });
}

const before = snapshotProtectedFiles();

expectBlocked(fixtures.blocked, 'ADMISSION_BLOCKED');
expectBlocked(fixtures.review, 'ADMISSION_REVIEW');
expectBlocked(fixtures.missing, 'ADMISSION_ARTIFACT_MISSING');
expectBlocked(fixtures.malformed, 'ADMISSION_ARTIFACT_MALFORMED');

expectBlocked(
  fixtures.inconsistentTrading,
  'TRADING_APPROVAL_INVARIANT_VIOLATION'
);

expectBlocked(
  fixtures.inconsistentResearch,
  'ADMISSION_ARTIFACT_INCONSISTENT'
);

expectReady(fixtures.approved);

const after = snapshotProtectedFiles();

assert.deepEqual(
  after,
  before,
  'Protected NIFTY MTF files were created, removed, or changed.'
);

process.stdout.write(
  [
    'PASS: BLOCKED -> 409 REFRESH_BLOCKED',
    'PASS: REVIEW -> 409 REFRESH_BLOCKED',
    'PASS: missing -> 409 REFRESH_BLOCKED',
    'PASS: malformed -> 409 REFRESH_BLOCKED',
    'PASS: inconsistent trading -> 409 REFRESH_BLOCKED',
    'PASS: inconsistent research flag -> 409 REFRESH_BLOCKED',
    'PASS: synthetic approved -> 200 readiness only',
    'PASS: approvedForTrading remains false',
    'PASS: NIFTY_1h.json immutable/absent',
    'PASS: NIFTY_4h.json immutable/absent'
  ].join('\n') + '\n'
);
