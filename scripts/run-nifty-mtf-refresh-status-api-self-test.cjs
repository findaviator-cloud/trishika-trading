'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { URL } = require('node:url');

const {
  niftyMtfRefreshStatusRoute
} = require('../dashboard/routes/nifty-mtf-refresh-status.cjs');

function createTestServer() {
  return http.createServer((req, res) => {
    const parsed = new URL(
      req.url,
      `http://${req.headers.host || '127.0.0.1'}`
    );

    if (
      parsed.pathname ===
      '/api/nifty-mtf/refresh-status'
    ) {
      niftyMtfRefreshStatusRoute(req, res);
      return;
    }

    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify({
      error: 'NOT_FOUND'
    }));
  });
}

function request(server, method, pathname) {
  const address = server.address();

  if (
    !address ||
    typeof address === 'string' ||
    typeof address.port !== 'number'
  ) {
    throw new Error(
      `Invalid test-server address: ${String(address)}`
    );
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        family: 4,
        port: address.port,
        method,
        path: pathname,
        headers: {
          Host: '127.0.0.1'
        }
      },
      (res) => {
        let body = '';

        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }
    );

    req.setTimeout(5000, () => {
      req.destroy(
        new Error(`Timed out: ${method} ${pathname}`)
      );
    });

    req.on('error', reject);
    req.end();
  });
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function main() {
  const server = createTestServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const get = await request(
      server,
      'GET',
      '/api/nifty-mtf/refresh-status'
    );

    assert.equal(
      get.statusCode,
      409,
      `GET response: ${get.body}`
    );

    assert.equal(
      get.headers['cache-control'],
      'no-store'
    );

    const getBody = JSON.parse(get.body);

    assert.equal(
      getBody.status,
      'REFRESH_BLOCKED'
    );

    assert.equal(
      getBody.approvedForResearchSource,
      false
    );

    assert.equal(
      getBody.approvedForTrading,
      false
    );

    assert.equal(
      getBody.readinessOnly,
      true
    );

    for (const method of [
      'POST',
      'PUT',
      'PATCH',
      'DELETE'
    ]) {
      const response = await request(
        server,
        method,
        '/api/nifty-mtf/refresh-status'
      );

      assert.equal(response.statusCode, 405);
      assert.equal(response.headers.allow, 'GET');
      assert.equal(
        response.headers['cache-control'],
        'no-store'
      );
    }

    const unknown = await request(
      server,
      'GET',
      '/api/nifty-mtf/unknown'
    );

    assert.equal(unknown.statusCode, 404);
    assert.equal(
      unknown.headers['cache-control'],
      'no-store'
    );

    process.stdout.write(
      [
        'PASS: API GET -> 409 REFRESH_BLOCKED',
        'PASS: API GET -> Cache-Control no-store',
        'PASS: API POST -> 405 Allow GET',
        'PASS: API PUT -> 405 Allow GET',
        'PASS: API PATCH -> 405 Allow GET',
        'PASS: API DELETE -> 405 Allow GET',
        'PASS: unknown route -> 404'
      ].join('\n') + '\n'
    );
  } finally {
    await closeServer(server);
  }
}

main().catch((error) => {
  console.error('API_SELF_TEST_FAILED');
  console.error(
    error && error.stack ? error.stack : error
  );
  process.exitCode = 1;
});
