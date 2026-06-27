// The legacy NestJS twenty-server that the strangler facade proxies un-ported routes to.
// In production set LEGACY_SERVER_URL to the running server (e.g. the Oracle/Hetzner deploy);
// falls back to the local dev server. REACT_APP_SERVER_BASE_URL is accepted as an alias so the
// same value the frontend already uses can be reused.
export const LEGACY_SERVER_URL: string =
  process.env.LEGACY_SERVER_URL ??
  process.env.REACT_APP_SERVER_BASE_URL ??
  'http://localhost:3000';
