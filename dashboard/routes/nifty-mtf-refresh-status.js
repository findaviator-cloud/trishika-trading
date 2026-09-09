import routeModule from './nifty-mtf-refresh-status.cjs';

const {
  niftyMtfRefreshStatusRoute,
  CANONICAL_ARTIFACT_PATH
} = routeModule;

/*
 * This adapter follows the existing dashboard route convention:
 * it returns structured data instead of writing directly to
 * the HTTP response object.
 *
 * The CommonJS route remains the isolated route-only regression target.
 * This ESM adapter is used only by the production dashboard router.
 */
export function niftyMtfRefreshStatusResult() {
  let captured;

  const responseAdapter = {
    writeHead(statusCode, headers) {
      captured = {
        statusCode,
        headers: headers ?? {}
      };
    },

    end(body) {
      if (!captured) {
        throw new Error('Refresh-status route ended without writeHead().');
      }

      captured.body = JSON.parse(String(body));
    }
  };

  niftyMtfRefreshStatusRoute(
    { method: 'GET' },
    responseAdapter
  );

  if (!captured) {
    throw new Error('Refresh-status route did not produce a response.');
  }

  return {
    statusCode: captured.statusCode,
    body: captured.body,
    canonicalArtifactPath: CANONICAL_ARTIFACT_PATH
  };
}
