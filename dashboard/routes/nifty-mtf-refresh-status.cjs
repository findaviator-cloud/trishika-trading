'use strict';

const path = require('node:path');

const {
  resolveReadiness
} = require('../lib/nifty-mtf-admission-guard.cjs');

const CANONICAL_ARTIFACT_PATH = path.resolve(
  __dirname,
  '../../admission/canonical/nifty-admission.json'
);

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(body));
}

function niftyMtfRefreshStatusRoute(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, {
      Allow: 'GET',
      'Cache-Control': 'no-store'
    });

    res.end();
    return;
  }

  const result = resolveReadiness({
    artifactPath: CANONICAL_ARTIFACT_PATH
  });

  writeJson(res, result.httpStatus, result.body);
}

module.exports = {
  niftyMtfRefreshStatusRoute,
  CANONICAL_ARTIFACT_PATH
};
