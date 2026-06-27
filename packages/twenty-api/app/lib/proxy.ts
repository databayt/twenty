import { type NextRequest } from 'next/server';

import { LEGACY_SERVER_URL } from './env';

// Pass a request straight through to the legacy twenty-server, preserving method, headers, query
// string, and body, and streaming the response back. This is the heart of the strangler facade:
// anything not yet ported into twenty-api is served by the legacy backend, transparently.
export const proxyToLegacy = async (
  request: NextRequest,
  targetPath: string,
): Promise<Response> => {
  const incomingUrl = new URL(request.url);
  const base = LEGACY_SERVER_URL.replace(/\/$/, '');
  const targetUrl = `${base}${targetPath}${incomingUrl.search}`;

  const headers = new Headers(request.headers);
  // These are recomputed by fetch / the upstream host.
  headers.delete('host');
  headers.delete('content-length');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);

  // Strip hop-by-hop encoding/length headers so the platform can re-chunk the streamed body.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
