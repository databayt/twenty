const getDefaultUrl = () => {
  if (
    window.location.hostname.endsWith('localhost') ||
    window.location.hostname.endsWith('127.0.0.1')
  ) {
    // In development environment front and backend usually run on separate ports
    // we set the default value to localhost:3000.
    // In dev context, we use env vars to overwrite it
    return `http://${window.location.hostname}:3000`;
  } else {
    // Outside of localhost we route to the public backend API over Tailscale Funnel.
    // This hostname is derived from the machine name + tailnet, so it survives reboots and
    // power cuts. The previous trycloudflare.com quick tunnels did not: cloudflared mints a
    // new random hostname on every start, so each outage needed a code change and a redeploy.
    return 'https://twenty-api.tail42a5c4.ts.net';
  }
};

export const REACT_APP_SERVER_BASE_URL =
  window._env_?.REACT_APP_SERVER_BASE_URL || getDefaultUrl();
