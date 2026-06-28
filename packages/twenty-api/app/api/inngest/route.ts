import { serve } from 'inngest/next';

import { inngest } from '../../lib/inngest/client';
import { companyCreated } from '../../lib/inngest/functions/company-created';
import { workspaceMetricsSnapshot } from '../../lib/inngest/functions/workspace-metrics-snapshot';

// Inngest serve endpoint: GET = introspection (lists functions), POST = function-execution callback,
// PUT = register/sync with the (dev or cloud) server. Prisma + node:crypto need the Node runtime —
// do NOT set edge. An explicit route beats the [...slug] catch-all, so /api/inngest is never proxied.
export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [workspaceMetricsSnapshot, companyCreated],
});
