import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit, diff } from "@/lib/audit";
import { can } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/session";
import { db, type DbLike } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { SETTING_DEFAULTS, settingsSchemas, type SettingKey, type SettingValue } from "./schema";

export async function getSetting<K extends SettingKey>(boardId: string, key: K, tx: DbLike = db): Promise<SettingValue<K>> {
  const row = await tx.setting.findUnique({ where: { boardId_key: { boardId, key } } });
  if (!row) return SETTING_DEFAULTS[key];
  // Merge over defaults so settings saved by an older version gain new fields safely.
  const merged = { ...SETTING_DEFAULTS[key], ...(row.value as object) };
  const parsed = settingsSchemas[key].safeParse(merged);
  return (parsed.success ? parsed.data : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function getAllSettings(boardId: string) {
  const keys = Object.keys(settingsSchemas) as SettingKey[];
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(boardId, k)] as const));
  return Object.fromEntries(entries) as { [K in SettingKey]: SettingValue<K> };
}

/** S-82: only the User & settings manager may change settings. */
export async function updateSetting<K extends SettingKey>(actor: Actor, key: K, value: unknown) {
  if (!actor.permissions.includes("USER_SETTINGS_MANAGER") || !can(actor, "users_settings", "create")) throw forbidden();
  const parsed = settingsSchemas[key].parse(value) as SettingValue<K>;
  return db.$transaction(async (tx) => {
    const before = await getSetting(actor.boardId, key, tx);
    await tx.setting.upsert({
      where: { boardId_key: { boardId: actor.boardId, key } },
      create: { boardId: actor.boardId, key, value: parsed as Prisma.InputJsonValue, updatedById: actor.userId },
      update: { value: parsed as Prisma.InputJsonValue, updatedById: actor.userId },
    });
    const changes = diff(before as Record<string, unknown>, parsed as Record<string, unknown>);
    await audit(tx, { ...actor, name: actor.name }, {
      action: "UPDATE",
      entityType: "Setting",
      entityId: key,
      summary: `Changed ${key} settings`,
      oldValue: changes.oldValue,
      newValue: changes.newValue,
      category: "SYSTEM",
    });
    return parsed;
  });
}
