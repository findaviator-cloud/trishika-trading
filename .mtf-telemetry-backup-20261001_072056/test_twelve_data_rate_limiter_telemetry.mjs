import assert from 'node:assert/strict';
import test from 'node:test';
import { getTwelveDataRateLimiterState } from '../src/services/twelve_data_rate_limiter.js';

test('limiter telemetry state exposes passive advisory fields', () => {
  const state = getTwelveDataRateLimiterState();
  assert.equal(state.telemetry.advisoryOnly, true);
  assert.equal(state.telemetry.accountWideQuotaAuthoritative, false);
  assert.equal(typeof state.telemetry.caller, 'string');
  assert.ok(Object.hasOwn(state.telemetry, 'apiCreditsUsed'));
  assert.ok(Object.hasOwn(state.telemetry, 'apiCreditsLeft'));
  assert.ok(Object.hasOwn(state.telemetry, 'rateLimitRemaining'));
});
