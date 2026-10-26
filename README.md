# DCB HRMS & Payroll

Web system for **Delhi Cantonment Board** that replaces FoxPro. It covers employee records, recruitment and onboarding, attendance, leave, payroll, salary slips, statutory files and tax, pension payments, and reports.
It has three logins (Admin, HR & Accounts Manager, Employee) and runs in Hindi and English.

- **Build plan and PRD traceability:** [PLAN.md](./PLAN.md)
- **What is done, what is pending, and decisions taken:** [PROGRESS.md](./PROGRESS.md)

## Tech stack

| | |
|---|---|
| App | Next.js 16 (App Router) + TypeScript (strict) |
| UI | Tailwind CSS v4, own component kit (white + green Delhi Cantt theme), Inter + Noto Sans Devanagari |
| Data | PostgreSQL 16 via Prisma 7 |
| Tests | Vitest (unit + database integration), Playwright (browser) |

## Getting started

```bash
# 1. PostgreSQL (or use your own server)
docker compose up -d

# 2. Configuration
cp .env.example .env
#    then fill DATA_ENCRYPTION_KEY, BLIND_INDEX_KEY and OTP_PEPPER with:  openssl rand -base64 32

# 3. Install, create the schema, load demo data
npm install
npm run db:deploy
npm run db:seed

# 4. Run
npm run dev            # http://localhost:3000
```

### Demo logins (development and training copies only)

All demo logins use the password **`Dcb@2026`**. With `SMS_PROVIDER=console` the OTP is printed in the server log and shown on the OTP screen.

| Sign in as | ID | Person | Permissions |
|---|---|---|---|
| Admin | `DCB10001` | Anil Sharma (CEO) | Approver |
| Admin | `DCB10002` | Sunita Verma (AO / DDO) | Approver, Pay bill signer |
| Admin | `IT01` | Rahul Mehta (IT cell) | User & settings manager |
| HR & Accounts | `DCB10003` | Priya Singh | HR |
| HR & Accounts | `DCB10004` | Mohit Gupta | Payroll |
| HR & Accounts | `DCB10005` | Kavita Rani | Pension |
| HR & Accounts | `DCB10006` | Deepak Yadav | Checker |
| HR & Accounts | `DCB10007` | Neha Arora | HR, Checker |
| Employee | `DCB10008` | Rajesh Kumar (Health section head) | Reporting officer |
| Employee | `DCB10010` or mobile `9810000010` | Suresh Pal | — |

Employees and pensioners can also choose **"With mobile OTP only"**.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm test` | Unit tests plus integration tests (needs `TEST_DATABASE_URL`, a throw-away database) |
| `npm run test:e2e` | Browser checks — run after `npm run build`; uses its own database (`E2E_DATABASE_URL`, rebuilt and seeded each run) and server on :3100. Set `BASE_URL` to test a running copy instead |
| `npm run db:migrate` | Create or apply a migration while developing |
| `npm run db:deploy` | Apply migrations (servers) |
| `npm run db:seed` | Load the Board, sections and posts, plus demo data outside production |

## Project layout

```
prisma/                 schema, migrations, seed
src/app/(auth)/         sign-in screen (S-01)
src/app/(app)/          signed-in screens (S-02 …), one folder per screen
src/app/api/v1/         REST API used by the screens (PRD §12 rule 4)
src/modules/<module>/   business rules and permission checks, one folder per module
src/lib/                auth, access matrix, approvals (maker-checker), audit, outbox, i18n, money, dates, connectors
src/components/         design system (ui/) and app shell (shell/)
tests/unit, tests/integration, e2e/
```

## Logo

The official Delhi Cantonment Board logo could not be downloaded from the build environment. Put the file at
**`public/brand/logo.png`** (a `.webp` or `.jpg` also works). It is then used on the sign-in screen, the sidebar and payslips, with no code change.
Until then a placeholder emblem (`public/brand/logo.svg`) is shown.

## Configuration notes

- `APP_ENV`: `development`, `test`, `training` or `production`. Production refuses to start with the console SMS provider.
- Aadhaar, PAN and bank account numbers are encrypted with `DATA_ENCRYPTION_KEY` (AES-256-GCM). **Losing this key means losing those fields.** Keep it in the Board's key custody, not in the repository.
- Portal passwords (TRACES, EPFO, CRA …) are never stored in the system. Settings name only the environment variables that hold gateway keys.
- Backups: `scripts/backup.sh` and `scripts/restore.sh` (encrypted, kept 90 days).
