import { Inngest } from 'inngest';

// One Inngest client per app. Dev: set INNGEST_DEV=1 and run `npx inngest-cli@latest dev` (no keys
// needed). Prod (Inngest Cloud): INNGEST_EVENT_KEY (outbound send) + INNGEST_SIGNING_KEY (verify
// inbound) from env. This is the Vercel-native replacement for twenty's always-on BullMQ worker.
export const inngest = new Inngest({ id: 'twenty-api' });
