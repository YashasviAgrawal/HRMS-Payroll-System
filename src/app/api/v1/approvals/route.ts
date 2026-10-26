import { apiRoute } from "@/lib/api/route";
import { listInbox } from "@/lib/approvals";

export const GET = apiRoute(async ({ actor }) => listInbox(actor));
