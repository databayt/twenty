// Vercel build-time injection of the frontend runtime config.
//
// Twenty's frontend reads its backend URL at runtime from
// window._env_.REACT_APP_SERVER_BASE_URL (see src/config/index.ts). In the
// Docker setup the NestJS server rewrites index.html at boot via
// src/utils/generate-front-config.ts. On a static Vercel deploy there is no
// server to do that, so we bake the value into build/index.html at build time
// from the REACT_APP_SERVER_BASE_URL environment variable configured in the
// Vercel project. This mirrors the server's BEGIN/END marker replacement so
// the two code paths stay in sync.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(scriptDir, '..', 'build', 'index.html');

const serverBaseUrl = process.env.REACT_APP_SERVER_BASE_URL?.trim();

// When the backend URL is unset we inject an empty _env_ so the frontend's
// getDefaultUrl() fallback resolves the API origin from the page hostname.
// That only works if the backend is served from the same origin, which is not
// the case for a Vercel-hosted frontend talking to a separate API host, so we
// warn loudly to surface a likely misconfiguration.
const envForFront = serverBaseUrl
  ? { REACT_APP_SERVER_BASE_URL: serverBaseUrl }
  : {};

const MARKER_REGEX =
  /<!-- BEGIN: Twenty Config -->[\s\S]*?<!-- END: Twenty Config -->/;

const configBlock = `<!-- BEGIN: Twenty Config -->
    <script id="twenty-env-config">
      window._env_ = ${JSON.stringify(envForFront, null, 2)};
    </script>
    <!-- END: Twenty Config -->`;

if (!fs.existsSync(indexPath)) {
  console.error(
    `[vercel-inject-env-config] build/index.html not found at ${indexPath}. ` +
      `Did "nx build twenty-front" run first?`,
  );
  process.exit(1);
}

const indexContent = fs.readFileSync(indexPath, 'utf8');

if (!MARKER_REGEX.test(indexContent)) {
  console.error(
    '[vercel-inject-env-config] Could not find the Twenty Config marker block ' +
      'in build/index.html. The index.html template may have changed.',
  );
  process.exit(1);
}

fs.writeFileSync(
  indexPath,
  indexContent.replace(MARKER_REGEX, configBlock),
  'utf8',
);

if (serverBaseUrl) {
  // oxlint-disable-next-line no-console
  console.log(
    `[vercel-inject-env-config] Injected REACT_APP_SERVER_BASE_URL=${serverBaseUrl}`,
  );
} else {
  // oxlint-disable-next-line no-console
  console.warn(
    '[vercel-inject-env-config] REACT_APP_SERVER_BASE_URL is not set. The ' +
      'frontend will fall back to its own origin for API calls, which only ' +
      'works if the backend is served from the same host. Set this variable ' +
      'in the Vercel project to your API URL (e.g. https://api.crm.databayt.org).',
  );
}
