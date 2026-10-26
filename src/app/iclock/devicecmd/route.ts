/** Devices report the result of commands; there are none, so just acknowledge. */
export function POST() {
  return new Response("OK", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
