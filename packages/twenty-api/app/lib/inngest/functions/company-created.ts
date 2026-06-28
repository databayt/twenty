import {
  handleCompanyCreated,
  type CompanyCreatedEvent,
} from '../../jobs/company-created';
import { inngest } from '../client';

// Event-driven job: reacts to a company being created (replaces the legacy entity-event -> worker
// queue coupling). Read-only, inside step.run for durable replay safety.
export const companyCreated = inngest.createFunction(
  { id: 'company-created', triggers: [{ event: 'twenty-api/company.created' }] },
  async ({ event, step }) =>
    step.run('react-to-company-created', () =>
      handleCompanyCreated(event.data as CompanyCreatedEvent),
    ),
);
