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
| Employee / Pensioner | `DCB09001` or mobile `9810000201` | Balbir Singh (retired 2016) | Pensioner |
| Employee / Pensioner | mobile `9810000202` (or PPO `DCB/PPO/2012/0031`) | Kamla Devi (family pensioner, Hindi) | Pensioner |

Employees and pensioners can also choose **"With mobile OTP only"**.

**Things to try in the demo:** Rajesh (`DCB10008`) has a missed-punch request and a CL application from Suresh waiting, and last month's Health attendance to lock (an unexplained day can be treated as leave); Anil (`DCB10001`, Admin) has a 5-day EL application from Pooja; Suresh (`DCB10010`) can apply for leave with a live balance; Neha (`DCB10007`) sees today's attendance board, the month register and the punch import; the holiday calendar is under Attendance → Holiday calendar. Every write goes to a second person (Checker or Admin) — sign in as `DCB10006` to check.

**Payroll (Module 6):** sign in as Mohit (`DCB10004`, HR & Accounts → Payroll) and run this month's payroll for a pay group — the last two months are already closed, so the change against last month shows. Fix the exceptions (Health has not locked last month; Manoj has a one-off recovery), send it to the Checker (`DCB10006`), approve and sign it as Sunita (`DCB10002`, Admin — the OTP shows on screen in demo mode), make the bank file, release it as Anil (`DCB10001`), then read a return file and close the month. Rates, pay heads and the pay matrix are under Payroll → Rates and rules (HR proposes, an Admin approves); standing deductions per person are under Payroll → Pay items (a Checker checks).

**Pay changes, arrears, loans and payslips (Module 7):** under Payroll → Increments and fixation, Mohit sends the 1 January increment list to the Checker, or works out a promotion's pay with the rule shown (Checker, then an Admin). Propose a back-dated DA order under Rates and rules, approve it, then Arrears and supplementary bills works out due vs drawn month by month and makes a supplementary bill that goes through the same five stages. Loans shows two running advances with their schedules; sanction a new one (Checker, then Admin). Employees open My payslips (Suresh, `DCB10010`) to download any month in Hindi or English; Payroll → Payslips downloads a section as one PDF.

**Statutory and tax (Module 8):** Statutory and tax opens on the due-date calendar — the demo's last two months are already filed (TDS deposited, NPS / ECR / pension fund files released), so the next items are the quarter's Form 24Q and this month's filings. Mohit (`DCB10004`) makes the 24Q under TDS and 24Q and an Admin (`DCB10001`) releases it; under Files the month's NPS, ECR, ESIC and pension fund files are made; under GPF and NPS an account opens (Rajesh Kumar has a running advance) and an advance can be sanctioned (Checker `DCB10006`, then an Admin), or uploads a CRA statement to match it with the pay bills. Tax declarations shows everyone's regime and tax for the year — Dr. Alok Mishra's declaration waits for the Checker — and Form 16 makes Part B, imports Part A PDFs named by PAN and sends the year for publishing. Employees choose their regime and declare investments under Payslips and Form 16 → My tax (both regimes worked out side by side), and see their GPF or NPS under GPF / NPS. TDS is worked out by the payroll each month; the pay sheet shows how. Tax slabs and due dates are under Rates and rules; the Board's TAN, DDO number and portal codes under Settings.

**Pension (Module 9):** sign in as Kavita (`DCB10005`, HR & Accounts → Pension). Pension bills shows the last two closed pension bills; work out this month's bill — it runs through the same five stages as salaries (Checker `DCB10006`, then `DCB10002` approves and signs with OTP). Dharam Pal (86) is held by the bill because his life certificate is a year overdue; his Jeevan Pramaan upload waits in Kavita's approvals — accept it and work the bill out again to see the held months paid with this month's pension. Pensioners lists everyone with the certificate status; a pensioner's page can change the record or record a death (a Checker approves; family pension starts the next day). New cases shows who retires in the next 12 months — start Rekha Sharma's case (retires 30 November): the calculator reads her service, pay, leave and GPF, every section answers the no-dues checklist, then the Checker and an Admin approve, the PPO prints for signature and the benefits bill pays gratuity, commuted value and leave encashment. Pension arrears works out a back-dated DR order for everyone in one bill; the commutation table is under Rates and rules → Pension tables. Pensioners sign in with their mobile and OTP (Balbir Singh, or Kamla Devi in Hindi) to see pension slips, the life certificate and their record.

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

## Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — NIC MeghRaj / MeitY cloud, the production, test and training
copies, nginx, backups and restore, logs, and the go-live checklist.

## Configuration notes

- `APP_ENV`: `development`, `test`, `training` or `production`. Production refuses to start with the console SMS provider, and the seed never loads demo data into it (elsewhere `SEED_DEMO=0` leaves it out).
- `TRUSTED_PROXY_HOPS`: how many reverse proxies add to `X-Forwarded-For` (nginx alone = 1).
- Aadhaar, PAN and bank account numbers are encrypted with `DATA_ENCRYPTION_KEY` (AES-256-GCM). **Losing this key means losing those fields.** Keep it in the Board's key custody, not in the repository.
- Portal passwords (TRACES, EPFO, CRA …) are never stored in the system. Settings name only the environment variables that hold gateway keys.
- Backups: `scripts/backup.sh` and `scripts/restore.sh` (encrypted, kept 90 days). 200-user check: `scripts/load-test.mjs` (test copies only).
- Biometric devices: eSSL / ZKTeco devices in push (ADMS) mode send to `<APP_URL>/iclock/cdata`; register each device's serial number in Settings → Attendance rules and devices. Files from any device can be imported under Attendance → Import punches.
- The demo holiday list for 2026 is for trying the system only — HR must enter the Board's notified list (a Checker approves it).
