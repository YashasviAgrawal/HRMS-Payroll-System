/**
 * The Board's statutory settings (TAN, DDO registration, professional tax …) read straight from the settings table, for
 * code that also runs outside Next.js (payroll working, seed). Same merge-over-defaults rule as the settings service.
 */
import type { DbLike } from "@/lib/db";
import { SETTING_DEFAULTS, settingsSchemas, type SettingValue } from "@/modules/settings/schema";

export type StatutorySettings = SettingValue<"statutory">;

export async function statutorySettings(tx: DbLike, boardId: string): Promise<StatutorySettings> {
  const row = await tx.setting.findUnique({ where: { boardId_key: { boardId, key: "statutory" } } });
  if (!row) return SETTING_DEFAULTS.statutory;
  const parsed = settingsSchemas.statutory.safeParse({ ...SETTING_DEFAULTS.statutory, ...(row.value as object) });
  return parsed.success ? parsed.data : SETTING_DEFAULTS.statutory;
}
