// Registry of routes served NATIVELY by twenty-api. Everything NOT covered here is proxied to the
// legacy twenty-server by the catch-all handler. As backend modules are ported (see
// .claude/docs/MIGRATION-LEDGER.md and the /backend-port skill), add their path prefixes here and
// give them their own route file — they then stop being proxied.
export const NATIVE_ROUTE_PREFIXES: readonly string[] = [
  '/healthz',
  '/rest/companies',
];

export const isNativeRoute = (pathname: string): boolean =>
  NATIVE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
