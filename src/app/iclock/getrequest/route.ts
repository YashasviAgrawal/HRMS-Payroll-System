/** Devices poll for commands; there are none to send. */
export function GET() {
  return new Response("OK", { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
