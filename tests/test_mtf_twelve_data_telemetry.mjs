import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTwelveDataRateLimiterState,
  recordTwelveDataTelemetry
} from '../src/services/twelve_data_rate_limiter.js';

test('telemetry helper accepts native Fetch Headers for approved MTF caller', () => {
  const headers = new Headers({
    'api-credits-used': '11',
    'api-credits-left': '89',
    'x-ratelimit-limit': '4',
    'x-ratelimit-remaining': '3',
    'x-ratelimit-reset': '60'
  });

  recordTwelveDataTelemetry(headers, 'mtf_child_process');

  const state = getTwelveDataRateLimiterState();
  assert.equal(state.telemetry.caller, 'mtf_child_process');
  assert.equal(state.telemetry.apiCreditsUsed, '11');
  assert.equal(state.telemetry.apiCreditsLeft, '89');
  assert.equal(state.telemetry.rateLimitLimit, '4');
  assert.equal(state.telemetry.rateLimitRemaining, '3');
  assert.equal(state.telemetry.rateLimitReset, '60');
});
