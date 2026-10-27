#!/usr/bin/env node
// PRD §16 performance check: 200 people using the system at the same time.
//
//   APP_ENV=test DATABASE_URL=... BASE_URL=https://hrms-test.example node scripts/load-test.mjs
//   USERS=200 SECONDS=90 THINK=1000-3000   (defaults)
//
// Opens USERS sessions for the active logins of the copy (13 in 20 are employees looking at their own
// screens, 6 in 20 HR & Accounts staff, 1 in 20 officers), then each person opens the screens their login
// uses with a pause between pages. Sessions are written straight into the database, so this runs only
// against a test or training copy, never production; they are removed at the end.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

if ((process.env.APP_ENV ?? "") === "production") throw new Error("Never run the load test against production.");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const USERS = Number(process.env.USERS ?? 200);
const SECONDS = Number(process.env.SECONDS ?? 90);
const [THINK_MIN, THINK_MAX] = (process.env.THINK ?? "1000-3000").split("-").map(Number);
const PAGES = {
  EMPLOYEE: ["/home", "/my/payslips", "/leave", "/my/attendance", "/my/record", "/leave/apply", "/my/requests"],
  HR_ACCOUNTS: ["/home", "/employees", "/attendance", "/attendance?tab=register", "/leave/manage", "/approvals", "/payroll", "/payroll/payslips", "/reports", "/reports/headcount", "/reports/pay-bill"],
  ADMIN: ["/home", "/approvals", "/admin/audit", "/reports", "/reports/pay-bill", "/admin/users"],
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const users = (await db.query(`select u.id, u."loginType" from "User" u where u.status = 'ACTIVE' and not ('USER_SETTINGS_MANAGER' = any(u.permissions))`)).rows;
const plan = [];
for (let i = 0; i < USERS; i++) {
  const r = i % 20;
  const type = r < 13 ? "EMPLOYEE" : r < 19 ? "HR_ACCOUNTS" : "ADMIN";
  const pool = users.filter((u) => u.loginType === type);
  if (!pool.length) throw new Error(`No active ${type} login in this copy.`);
  plan.push({ user: pool[i % pool.length], type, token: randomBytes(32).toString("base64url") });
}
const expires = new Date(Date.now() + 2 * 3600_000);
for (const p of plan) {
  await db.query(`insert into "Session"(id, "userId", "expiresAt", "userAgent") values ($1, $2, $3, 'load-test')`, [createHash("sha256").update(p.token).digest("hex"), p.user.id, expires]);
}

const times = [];
const errors = [];
const stopAt = Date.now() + SECONDS * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function person(p, i) {
  const pages = PAGES[p.type];
  await sleep(Math.random() * 2000);
  for (let n = i; Date.now() < stopAt; n++) {
    const path = pages[n % pages.length];
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + path, { headers: { cookie: `dcb_session=${p.token}` }, redirect: "manual" });
      await res.arrayBuffer();
      if (res.status === 200) times.push(performance.now() - t0);
      else errors.push(`${res.status} ${path}`);
    } catch (e) {
      errors.push(`${e.message} ${path}`);
    }
    await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
  }
}
const started = Date.now();
try {
  await Promise.all(plan.map(person));
} finally {
  await db.query(`delete from "Session" where "userAgent" = 'load-test'`);
  await db.end();
}
const secs = (Date.now() - started) / 1000;
const sorted = times.sort((a, b) => a - b);
const q = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0);
console.log(`${USERS} people for ${secs.toFixed(0)} s: ${times.length} pages (${(times.length / secs).toFixed(1)} a second), ${errors.length} errors${errors.length ? ` — ${[...new Set(errors)].slice(0, 5).join("; ")}` : ""}`);
console.log(`time per page: median ${q(50)} ms · 95% under ${q(95)} ms · 99% under ${q(99)} ms`);
process.exit(errors.length ? 1 : 0);
