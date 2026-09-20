// Twenty CRM frontend (hogwarts/mkan/sijillee/moallimee/sales/app.databayt.org) on Cloudflare.
//
// Static assets only. The backend runs in Docker on Abdout's Mac, published by Tailscale
// Funnel, and the browser talks to it DIRECTLY: the build bakes
// `window._env_.REACT_APP_SERVER_BASE_URL` to the Funnel URL, so API calls never pass
// through this Worker.
//
// That is not a style choice. **Cloudflare cannot complete a TLS handshake with a Tailscale
// Funnel** — measured: this same Worker fetched example.com and www.databayt.org with 200
// while every request to the Funnel came back 525. So a Worker CANNOT proxy to the Mac, and
// same-origin API paths are impossible while the backend lives there. Cross-origin is fine:
// the Funnel answers `Access-Control-Allow-Origin: *` and Twenty authenticates with bearer
// tokens rather than cookies.
//
// If the backend ever moves to a Cloudflare Container again, put the API-path proxy back and
// reach it over a SERVICE BINDING, not a fetch to its hostname — a Worker's fetch to a
// hostname in its own zone does not re-enter that hostname's Worker, it hits the origin,
// which is a proxied AAAA 100:: black hole, and every call 522s.

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Legacy hosts: <ws>.crm.databayt.org -> <ws>.databayt.org. No DNS backs this today —
    // Universal SSL covers databayt.org and *.databayt.org, one label, so *.crm.databayt.org
    // would need Advanced Certificate Manager. Kept so the behaviour is ready if that changes.
    const crm = url.hostname.match(/^([^.]+)\.crm\.databayt\.org$/)
    if (crm) {
      return Response.redirect(
        `https://${crm[1]}.databayt.org${url.pathname}${url.search}`,
        307,
      )
    }

    // `not_found_handling: single-page-application` serves index.html for client-side routes.
    return env.ASSETS.fetch(request)
  },
}
