export class ConnectionError extends Error {}

// True when a send failed only because the internet or WhatsApp connection is down.
// Those failures are not counted against a post: it simply waits and goes out when we are back online.
export function isConnectionProblem(e) {
  return (
    e instanceof ConnectionError ||
    /connection closed|timed out|not connected|socket|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(String(e?.message || e))
  );
}
