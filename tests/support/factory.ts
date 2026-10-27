import type { LoginType, Permission } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/auth/session";
import { db } from "@/lib/db";

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase();

export async function makeBoard() {
  const code = process.env.BOARD_CODE ?? "DCB";
  return db.board.upsert({ where: { code }, create: { code, name: "Delhi Cantonment Board", nameHi: "दिल्ली छावनी परिषद" }, update: {} });
}

export async function makeSection(boardId: string, code = `S${uid()}`) {
  return db.section.create({ data: { boardId, code, name: `Section ${code}`, nameHi: `अनुभाग ${code}` } });
}

export async function makePost(boardId: string, level = "6") {
  const code = `P${uid()}`;
  return db.post.create({ data: { boardId, code, name: `Post ${code}`, nameHi: `पद ${code}`, payLevel: level, group: "C" } });
}

export async function makeEmployee(boardId: string, opts: { sectionId?: string; postId?: string; dob?: string; status?: "ACTIVE" | "RETIRED" } = {}) {
  const sectionId = opts.sectionId ?? (await makeSection(boardId)).id;
  const postId = opts.postId ?? (await makePost(boardId)).id;
  return db.employee.create({
    data: {
      boardId,
      employeeCode: `E${uid()}`,
      type: "PERMANENT_NPS",
      status: opts.status ?? "ACTIVE",
      firstName: "Test",
      lastName: uid(),
      gender: "M",
      dateOfBirth: new Date(`${opts.dob ?? "1990-05-05"}T00:00:00Z`),
      dateOfJoining: new Date("2015-01-01T00:00:00Z"),
      dateOfRetirement: new Date("2050-05-31T00:00:00Z"),
      sectionId,
      postId,
    },
  });
}

export async function makeUser(boardId: string, loginType: LoginType, permissions: Permission[] = [], employeeId: string | null = null) {
  const id = uid();
  return db.user.create({
    data: { boardId, loginType, loginId: `U${id}`, displayName: `User ${id}`, mobile: `9${String(Date.now() + counter++).slice(-9)}`, permissions, employeeId, mustChangePassword: false },
  });
}

/** Builds the Actor a service would receive for this user. */
export async function actorFor(userId: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { employee: true } });
  const pension = u.pensionerId ? { id: u.pensionerId } : u.employeeId ? await db.pensioner.findFirst({ where: { employeeId: u.employeeId, relation: "SELF" }, select: { id: true } }) : null;
  const onRolls = Boolean(u.employee) && ["ACTIVE", "SUSPENDED"].includes(u.employee!.status);
  return {
    userId: u.id,
    sessionId: "test",
    boardId: u.boardId,
    loginId: u.loginId,
    name: u.displayName,
    nameHi: u.displayNameHi,
    loginType: u.loginType,
    permissions: u.permissions,
    employeeId: u.employeeId,
    sectionId: u.employee?.sectionId ?? null,
    isEmployee: pension ? onRolls : Boolean(u.employee),
    isPensioner: Boolean(pension),
    pensionerId: pension?.id ?? null,
    language: "en",
    mustChangePassword: false,
    ip: "127.0.0.1",
    userAgent: "vitest",
  };
}

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
