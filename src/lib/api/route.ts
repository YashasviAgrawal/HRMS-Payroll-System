import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getActor, type Actor } from "@/lib/auth/session";
import { AppError, badRequest, forbidden, unauthorized } from "@/lib/errors";
import { makeT, type TKey } from "@/lib/i18n";
import { lookup } from "@/lib/i18n/types";
import { en } from "@/lib/i18n/en";
import { getLocale } from "@/lib/i18n/server";
import { getRequestMeta, type RequestMeta } from "@/lib/request-meta";

/**
 * Every REST endpoint under /api/v1 goes through here (PRD §12 rule 4: the screens use the same APIs).
 * It handles the session, a same-origin check on writes, JSON validation and translated error messages.
 */
type Params = Record<string, string>;

interface Ctx<P extends Params> {
  req: NextRequest;
  params: P;
  meta: RequestMeta;
  /** Parses and validates the JSON body. */
  body<T>(schema: ZodType<T>): Promise<T>;
  /** Parses and validates the query string. */
  query<T>(schema: ZodType<T>): T;
}

type AuthedHandler<P extends Params> = (ctx: Ctx<P> & { actor: Actor }) => Promise<unknown>;
type PublicHandler<P extends Params> = (ctx: Ctx<P> & { actor: Actor | null }) => Promise<unknown>;

type RouteContext<P> = { params: Promise<P> };

function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; the session cookie is SameSite=Lax
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("errors.badOrigin");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw forbidden("errors.badOrigin");
  }
}

function zodToAppError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (fields[path]) continue;
    if (lookup(en, issue.message)) fields[path] = issue.message;
    else if (issue.code === "invalid_type" || (issue.code === "too_small" && "minimum" in issue && issue.minimum === 1)) {
      fields[path] = "validation.required";
    } else if (issue.code === "too_small") fields[path] = "validation.tooShort";
    else if (issue.code === "too_big") fields[path] = "validation.tooLong";
    else fields[path] = "validation.invalid";
  }
  return badRequest("errors.validation", fields);
}

async function toErrorResponse(error: unknown) {
  const t = makeT(await getLocale().catch(() => "en" as const));
  const appError = error instanceof ZodError ? zodToAppError(error) : error instanceof AppError ? error : null;
  if (!appError) {
    console.error("[api] unexpected error", error);
    return NextResponse.json({ ok: false, error: { code: "server_error", message: t("errors.generic") } }, { status: 500 });
  }
  const fields = appError.fields
    ? Object.fromEntries(
        Object.entries(appError.fields).map(([k, v]) => [k, lookup(en, v) ? t(v as TKey, appError.vars) : v]),
      )
    : undefined;
  return NextResponse.json(
    { ok: false, error: { code: appError.code, message: t(appError.key, appError.vars), fields } },
    { status: appError.status },
  );
}

function build<P extends Params>(req: NextRequest, params: P, meta: RequestMeta): Ctx<P> {
  return {
    req,
    params,
    meta,
    async body<T>(schema: ZodType<T>) {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw badRequest();
      }
      return schema.parse(raw);
    },
    query<T>(schema: ZodType<T>) {
      return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    },
  };
}

function respond(result: unknown) {
  if (result instanceof Response) return result;
  return NextResponse.json({ ok: true, data: result ?? null });
}

export function apiRoute<P extends Params = Params>(handler: AuthedHandler<P>) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    try {
      checkOrigin(req);
      const actor = await getActor();
      if (!actor) throw unauthorized();
      const params = (await context?.params) ?? ({} as P);
      const meta = await getRequestMeta();
      return respond(await handler({ ...build(req, params, meta), actor }));
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

export function publicRoute<P extends Params = Params>(handler: PublicHandler<P>) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    try {
      checkOrigin(req);
      const actor = await getActor();
      const params = (await context?.params) ?? ({} as P);
      const meta = await getRequestMeta();
      return respond(await handler({ ...build(req, params, meta), actor }));
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}
