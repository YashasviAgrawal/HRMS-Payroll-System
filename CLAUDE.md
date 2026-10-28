@AGENTS.md

# DCB HRMS & Payroll — working notes

- **Source of truth:** the Release 1 PRD. Build order and PRD IDs: `PLAN.md`. What is done / pending / decided: `PROGRESS.md`.
  Read both before starting work and update both when a module or feature lands.
- **Stack:** Next.js 16 (App Router, `src/proxy.ts` instead of middleware), TypeScript strict, Tailwind v4, Prisma 7 + PostgreSQL 16.
- **Layers:** `src/modules/<module>/service.ts` holds business rules and permission checks; `src/app/api/v1/**` are thin REST wrappers
  (`apiRoute`); pages read through the same services. Every write: audit (`lib/audit.ts`) + outbox (`lib/outbox.ts`) in the same transaction;
  maker-checker through `lib/approvals`.
- **Permissions:** `lib/auth/access.ts` is PRD §14 as data — never hard-code role checks in pages. Menus: `lib/auth/menu.ts` (≤ 8 items).
- **Text:** every visible string lives in `lib/i18n/en.ts` and `hi.ts` (same keys — a unit test enforces it). Simple words.
- **Money:** `lib/money.ts` (paise maths, rupee rounding). **Dates:** `lib/dates.ts` (ISO strings, India time).
- **Checks before commit:** `npm run typecheck && npm run lint && npm test && npm run build`; browser checks: `npm run test:e2e` (after a build — it rebuilds and seeds `E2E_DATABASE_URL` and starts its own server on :3100).
- **Phone layout:** wide tables use `<Table stack>` with `<Td label>` so they become cards; `e2e/layout.phone.spec.ts` fails if a page scrolls sideways.
- **Browser checks sign in once per login** (`e2e/helpers.ts` saves the session; `fresh: true` forces the real screen) because the app allows 5 OTPs per login in 10 minutes.
- **Attendance:** rules are pure (`modules/attendance/rules.ts`) and shared by service, screens, seed and tests; punches are stored raw and a day's status is worked out when shown — only decisions are saved.
- **Payroll:** the pay engine is pure (`modules/payroll/engine.ts`); `compute.ts` reads the records and saves a run (no "server-only", the seed uses it);
  `run.ts` is the five stages, `pay.ts` the bank / return files and close, `outputs.ts` the PDFs. A month uses the rates and matrix in force on the 1st.
- **Statutory & tax:** pure rules in `modules/statutory/` (`tax-rules.ts`, `gpf-rules.ts`, `formats.ts`, `calendar.ts`); TDS is projected
  inside `computeRun` (`tds-projection.ts`, no "server-only") — never a pay item; `gpf-posting.ts` posts GPF from approved bills;
  `stat-build.ts` builds the monthly files (seed-safe). Worked-out deductions (LOAN, GPF_REFUND, IT, PT) pass to the engine in `items`.
- **Leaving service (client add-on):** `employees/separation.ts` records suspensions and exits (Checker → Admin) and
  moves people off the rolls after the last day (`applyExits`, daily); the full and final settlement is
  `payroll/settlement.ts` (statement, approvals, receipts) on pure rules in `settlement-rules.ts`; the settlement bill
  is a SUPPLEMENTARY run with source `SETTLEMENT` built and closed by `settlement-bill.ts` (hooked into `run.ts`).
- **Pension:** pure rules in `modules/pension/rules.ts` (a month's pension, restoration, additional pension, life
  certificate dates) and `calculator.ts` (the case); `compute.ts` works out the pension bill (pay group PENSION, called
  from `computeRun`, seed-safe) with catch-up of unpaid months and the system hold; `case-facts.ts` reads a case's facts
  (seed-safe); `bills.ts` arrears and benefits bills; `cases.ts`, `events.ts` (retirements, deaths), `pensioners.ts`,
  `life-certificates.ts`, `tables.ts`, `ppo.ts`. Pension bills reuse the payroll run screen (`payroll/[id]/run-screen.tsx`)
  under `/pension/bills`; rights follow `fnOf(payGroup)`. Every pension slip carries `pensionerId`; salary-side readers
  filter `pensionerId: null`.
