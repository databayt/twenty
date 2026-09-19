// Twenty CRM backend on Cloudflare Containers — a thin Worker in front of one always-on
// container running the Twenty server, its worker, and a local Redis.
//
// No sleepAfter: the whole point of this migration is that the CRM stays up when Abdout's
// MacBook is off, so the instance must not idle out.
import { Container, getContainer } from "@cloudflare/containers"

export class TwentyContainer extends Container {
  defaultPort = 3000

  constructor(ctx, env) {
    super(ctx, env)
    // Every string binding (Worker secrets + vars) becomes container env.
    // Applied at container start only — rotating a secret needs a restart, which the
    // per-deploy stamp in Dockerfile.cf-api guarantees.
    this.envVars = Object.fromEntries(
      Object.entries(env).filter(([, v]) => typeof v === "string")
    )
  }
}

export default {
  async fetch(request, env) {
    return getContainer(env.TWENTY, "main").fetch(request)
  },
}
