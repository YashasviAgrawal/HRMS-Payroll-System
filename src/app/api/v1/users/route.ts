import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { LoginType } from "@/generated/prisma/enums";
import { createUser, listUsers, userCreateSchema } from "@/modules/users/service";

const listQuery = z.object({
  q: z.string().optional(),
  loginType: z.enum(LoginType).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const GET = apiRoute(async ({ actor, query }) => listUsers(actor, query(listQuery)));
export const POST = apiRoute(async ({ actor, body }) => createUser(actor, await body(userCreateSchema)));
