import { currentBoard } from "@/lib/board";
import { devicePush } from "@/modules/attendance/imports";

/**
 * Device sync (AT-01) for eSSL / ZKTeco devices in push ("ADMS") mode. The device asks for its options
 * with GET and sends attendance lines with POST ?table=ATTLOG. Only serial numbers registered in
 * Settings are accepted; anything else is refused without detail.
 */
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

function serialOf(req: Request) {
  const sn = new URL(req.url).searchParams.get("SN") ?? "";
  return /^[A-Za-z0-9_-]{3,40}$/.test(sn) ? sn : null;
}

export async function GET(req: Request) {
  const sn = serialOf(req);
  if (!sn) return text("Unknown device", 403);
  const board = await currentBoard();
  // An empty push accepts or refuses the device without saving anything.
  const result = await devicePush(board.id, sn, "", null);
  if (!result.accepted) return text("Unknown device", 403);
  return text(
    [`GET OPTION FROM: ${sn}`, "ATTLOGStamp=None", "OPERLOGStamp=9999", "ATTPHOTOStamp=9999", "ErrorDelay=60", "Delay=30", "TransTimes=00:00;14:05", "TransInterval=1", "TransFlag=TransData AttLog", "Realtime=1", "Encrypt=None"].join("\n"),
  );
}

export async function POST(req: Request) {
  const sn = serialOf(req);
  if (!sn) return text("Unknown device", 403);
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return text("Too large", 413);
  const table = new URL(req.url).searchParams.get("table");
  const body = await req.text();
  const board = await currentBoard();
  if (table !== "ATTLOG") {
    // Operation logs, photos and user lists are not needed; acknowledge so the device does not resend.
    const result = await devicePush(board.id, sn, "", null);
    return result.accepted ? text("OK") : text("Unknown device", 403);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const result = await devicePush(board.id, sn, body, ip);
  if (!result.accepted) return text("Unknown device", 403);
  return text(`OK: ${result.received}`);
}
