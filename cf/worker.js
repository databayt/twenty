// Twenty CRM frontend (hogwarts/mkan/sijillee/moallimee/app.databayt.org) on Cloudflare.
//
// This replaces the Vercel deployment described by vercel.json, and has to reproduce two
// things it did: proxy the API paths to the backend so the SPA sees them as SAME-ORIGIN
// (the build ships `window._env_ = {}`, so the frontend resolves its API from the page
// origin), and fall back to index.html for client-side routes.
//
// The backend is the Twenty server running in a Cloudflare Container (the `twenty-api`
// Worker), with Postgres on Neon and attachments in R2 — so the CRM no longer depends on
// Abdout's MacBook being awake. It used to proxy to a Tailscale Funnel on that Mac; that
// could never work from here anyway, because Cloudflare cannot complete a TLS handshake
// with Funnel (proven: the same Worker reaches every other host fine and only the Funnel
// returned 525).

// Every prefix vercel.json rewrote to the backend. Matched as a path prefix, so `/rest` and
// `/rest/anything` both go; `/restaurants` would not.
const API_PREFIXES = [
  "/graphql",
  "/metadata",
  "/client-config",
  "/healthz",
  "/auth",
  "/oauth",
  "/rest",
  "/mcp",
  "/apps",
  "/app/billing",
  "/emailing",
  "/files",
  "/open-api",
  "/.well-known",
]

const isApiPath = (pathname) =>
  API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Legacy hosts: <ws>.crm.databayt.org → <ws>.databayt.org, as vercel.json redirected.
    // NOTE: no DNS record backs this today. Universal SSL covers databayt.org and
    // *.databayt.org — one label — so *.crm.databayt.org would need Advanced Certificate
    // Manager. Adding the record without it turns a dead host into a TLS error. The branch
    // stays so the behaviour is ready the moment that cert exists.
    const crm = url.hostname.match(/^([^.]+)\.crm\.databayt\.org$/)
    if (crm) {
      return Response.redirect(
        `https://${crm[1]}.databayt.org${url.pathname}${url.search}`,
        307,
      )
    }

    if (isApiPath(url.pathname)) {
      // Straight to the twenty-api Worker over the service binding, passing the request
      // untouched — method, body stream and headers, Origin included, which is how Twenty
      // resolves which workspace a request belongs to.
      return env.API.fetch(request)
    }

    // Static assets. `not_found_handling: single-page-application` in wrangler.jsonc serves
    // index.html for unknown paths, which is the client-side routing fallback.
    return env.ASSETS.fetch(request)
  },
}
