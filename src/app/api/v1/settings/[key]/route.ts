import { apiRoute } from "@/lib/api/route";
import { notFound, forbidden } from "@/lib/errors";
import { can } from "@/lib/auth/access";
import { settingsSchemas, type SettingKey } from "@/modules/settings/schema";
import { getSetting, updateSetting } from "@/modules/settings/service";

function key(raw: string): SettingKey {
  if (!(raw in settingsSchemas)) throw notFound();
  return raw as SettingKey;
}

export const GET = apiRoute<{ key: string }>(async ({ actor, params }) => {
  if (!can(actor, "users_settings", "view")) throw forbidden();
  return getSetting(actor.boardId, key(params.key));
});

export const PUT = apiRoute<{ key: string }>(async ({ actor, params, req }) => {
  const value: unknown = await req.json().catch(() => null);
  return updateSetting(actor, key(params.key), value);
});
