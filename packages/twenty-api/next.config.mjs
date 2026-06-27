// twenty-api — headless Next.js backend (route handlers only, no UI).
// Slice 0: a strangler-fig facade that proxies every request to the legacy
// NestJS twenty-server (LEGACY_SERVER_URL) except routes served natively here.
// See .claude/docs/VERCEL-BACKEND.md for the full architecture.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Route handlers must run on the Node.js runtime (the proxy streams arbitrary
  // request/response bodies and the future Prisma layer needs Node APIs).
  serverExternalPackages: [],
};

export default nextConfig;
