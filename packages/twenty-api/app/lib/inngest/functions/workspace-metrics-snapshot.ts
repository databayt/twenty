import { runWorkspaceMetricsSnapshot } from '../../jobs/workspace-metrics-snapshot';
import { inngest } from '../client';

// Vercel-native replacement for a twenty BullMQ cron (the 02:30 UTC daily-maintenance slot). The side
// effect lives inside step.run and is idempotent, so Inngest's durable replay is safe.
export const workspaceMetricsSnapshot = inngest.createFunction(
  { id: 'workspace-metrics-snapshot', triggers: [{ cron: 'TZ=UTC 30 2 * * *' }] },
  async ({ step }) =>
    step.run('compute-and-record', () => runWorkspaceMetricsSnapshot()),
);
