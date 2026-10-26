# DCB HRMS & Payroll — Release 1 Build Plan

Source of truth: **DCB HRMS & Payroll — Release 1 PRD** (Oct 26, 2026).
Every checklist item below carries the PRD requirement ID it satisfies (EM-01, PR-10, S-40 …)
so we can prove alignment line by line. Progress and change history live in [PROGRESS.md](./PROGRESS.md).

**Legend:** `[x]` done and verified · `[~]` partly done (see note) · `[ ]` pending

---

## How the build is split

Release 1 is split into **10 modules** that are built in order. Each module sits on top of the
ones before it and is shipped as one or more commits that work on their own (tests green, app builds, screens
checked in a real browser, PRD rows ticked).

| # | Module | PRD sections | Screens | Depends on |
|---|--------|--------------|---------|------------|
| 1 | Foundation & platform | §2, §12 rules, §13 menus, §14, §16 | S-01, S-02, S-03, S-04, S-71, S-80, S-82 | — |
| 2 | Employee master | §4 (EM-01…10) | S-10, S-11, S-12, S-13, S-14 | 1 |
| 3 | Recruitment & onboarding | §5 (RO-01…09) | S-20, S-21, S-22 | 1, 2 |
| 4 | Attendance & holidays | §6 (AT-01…08) | S-30, S-32 | 1, 2 |
| 5 | Leave | §7 (LV-01…07) | S-31 | 1, 2, 4 |
| 6 | Rates & rules + monthly payroll | §8 (PR-01…05, PR-10…14) | S-81, S-40 | 1, 2, 4, 5 |
| 7 | Pay changes, arrears, loans, salary slips | §8 (PR-06…09, SL-01…05) | S-41, S-42, S-43, S-44 | 6 |
| 8 | Statutory & tax | §9 (ST-01…09) | S-50, S-51, S-52, S-53 | 6 |
| 9 | Pension | §10 (PN-01…12) | S-60, S-61, S-62 | 6, 8 |
| 10 | Reports, dashboards, migration & go-live | §11, §15, §16 | S-70, S-90 (+ final S-02 tiles) | all |

**Definition of done (for every module)**
1. Data model + migration, service layer with permission checks, REST API under `/api/v1/...`.
2. Screens in English and Hindi, mobile-friendly, at most one dark primary button per screen.
3. Every write goes through maker-checker where the PRD asks, and writes to the audit trail and the outbox.
4. Unit tests for every rule or calculation, plus a browser check of the main flow (Playwright).
5. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` are all green.
6. The PRD rows for the module are re-read and ticked here only when they are met.

---

## Technical foundation (decided)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript (strict)** | One codebase for the screens and the REST API (PRD §12 rule 4) |
| Styling | **Tailwind CSS v4**, own component kit, white + green Delhi Cantt theme | Premium, light, fast on low-end Android |
| Database | **PostgreSQL 16** via **Prisma 7** | PRD §16 asks for PostgreSQL; dated tables, JSON history, triggers |
| Auth | Own session + OTP (no third-party identity) | Govt hosting, OTP on every login (§2 rule 4), 15-min idle timeout |
| Sensitive data | AES-256-GCM encryption + HMAC "blind index" for duplicate checks | Aadhaar / PAN / bank encrypted at rest, masked on screen, duplicates still blocked (EM-03) |
| Money | Rupees stored as `Decimal(14,2)`, maths in integer paise, govt rounding to the rupee | Match FoxPro to ₹1 (§1) |
| Rules | Dated, editable tables + a small safe formula language for pay heads | A DA change is a table entry, never code (§8) |
| Integrations | Connector interface with `file` mode now, `api` mode later | §12 design rules 1–8 |
| PDFs | Print-ready HTML rendered to PDF by headless Chromium | Correct Hindi (Devanagari) shaping on payslips, PPO, pay bill |
| Excel | `exceljs` for templates, imports and exports | EM-10, RO-03, reports |
| Tests | Vitest (unit + DB integration), Playwright (browser) | — |
| Multi-Board | Every business table carries `boardId`; only DCB is exposed | §16 "multi-Board support in the data model" |

---

## Module 1 — Foundation & platform
_Goal: a secure, bilingual shell that every later module plugs into._

**Project set-up**
- [x] Next.js 16 + TS strict + Tailwind v4 + ESLint scaffold
- [x] Prisma 7 + PostgreSQL, migrations, seed script, `docker-compose.yml` for local Postgres
- [x] Vitest + Playwright set-up, `npm run check` (typecheck + lint + test)
- [x] `.env.example`, config validation at start-up (fail fast on missing secrets); `APP_ENV` for production / test / training copies

**Design system (white + green, premium, simple words)**
- [x] Theme tokens (brand green scale, neutrals, success/warn/danger), Inter + Noto Sans Devanagari
- [x] Components: Button (one dark primary per screen), Input, Select, Textarea, Checkbox, Card, Badge, Tabs, Table (keyboard-first rows), Dialog, Toast, EmptyState, PageHeader, StatTile, Segmented, OTP input, Pagination, Skeleton — _Stepper comes with the payroll screen (Module 6)_
- [x] Logo slot — drop the official file at `public/brand/logo.png`; placeholder emblem until then
- [~] Accessibility basics: focus rings, labelled fields, skip link, AA colours, rem sizing (§16) — _formal GIGW/WCAG pass in Module 10_

**Language**
- [x] Hindi / English switch on every screen incl. login (S-01, §16), remembered per user (S-03)

**Logins, sessions and permissions (§2)**
- [x] Three logins: Admin, HR & Accounts Manager, Employee (pensioners use Employee login)
- [x] Permissions Admin can tick: Approver · Pay bill signer · User & settings manager · HR · Payroll · Pension · Checker · Reporting officer
- [x] S-01 Login: Employee ID or mobile + password + OTP; employees and pensioners may use mobile + OTP only (rule 4)
- [x] OTP: 6 digits, 5-minute expiry, 5 tries, 30 s resend cool-down, 5 per 10 min; 5 wrong passwords lock 15 min; no account probing
- [x] Sessions time out after 15 minutes idle (rule 7) with a 2-minute warning; password change signs out other devices
- [~] Access ends automatically on retirement / resignation / transfer / death (rule 6) — _pensioner view switches on with the pensioner record in Module 9_
- [x] Access matrix (§14) coded as one permission table + scope (own record / own section) + unit tests for every cell
- [x] User & settings manager can never see pay, bank or Aadhaar (rule 3, §14 note); cannot be combined with Approver / Pay bill signer
- [x] Reporting officer sees only own section; scope is read from the person's employee record, so moving the person moves the access (rule 5)

**Shared platform services**
- [x] Audit trail: every create / edit / approve / print with user, time, IP, old and new value; cannot be edited (DB trigger) (§11, §16)
- [x] Outbox: every approved change writes an event (§12 rule 5)
- [x] Maker-checker engine: nobody approves their own entry (rule 1); nobody processes their own pay, loan or arrears (rule 2)
- [x] S-04 Approvals inbox: everything waiting for me, oldest first (+ raised by me, decided by me)
- [~] Connector framework (file now / API later) + SMS gateway (console mode / HTTP provider with DLT ids) (§12) — _email sending arrives with payslips (Module 7)_
- [~] File registry table in place — _preview → Admin approve → checksum → download flow is built with the first generated file (Module 3 PRAN file)_
- [ ] Document storage (PDF / image ≤ 5 MB) with checksum — _moved to Module 2 (EM-05)_

**Screens**
- [x] App shell: menu of at most 8 items per login, built from ticked permissions (§13); phone bottom bar for employees
- [x] S-02 Home: "My work" list + dashboard tiles (each module adds its own)
- [x] S-03 My profile & password: change password, mobile (with OTP), language; first sign-in forces own password
- [x] S-80 Users & permissions: create users, tick permissions, see section scope, disable, reset password
- [x] S-82 System settings: SMS/email, bank format, attendance lock day, connectors, backup scripts
- [x] S-71 Audit trail: filter by text, action, date; settings manager sees system events only

**Seed / demo data**
- [x] Board (DCB), 12 sections, 19 posts, 25 demo employees, demo users for every login + permission

---

## Module 2 — Employee master (§4)
- [ ] EM-01 One record per person, unique Employee ID; types: Permanent-OPS, Permanent-NPS, Contract, Daily wage, Re-employed, Deputation
- [ ] EM-02 Job details: section, post, pay level & cell, DOB, DOJ; date of retirement auto-calculated (last day of month of turning 60, or post's rule; born on the 1st → previous month end)
- [ ] EM-03 PAN, Aadhaar (masked + encrypted), PRAN/UAN, ESIC, bank account + IFSC; duplicates blocked at entry
- [ ] EM-04 Family and nominees for GPF, gratuity, group insurance, family pension (shares add to 100%)
- [ ] EM-05 Documents: appointment order, certificates, ID proofs; PDF/image up to 5 MB
- [ ] EM-06 e-Service book: dated events (appointment, confirmation, increment, promotion, MACP, transfer, leave, penalty) with order no., date, attached order
- [ ] EM-07 Change to pay level, bank or identity: made by HR, approved by Checker before it affects pay
- [ ] EM-08 Employee requests change to address, mobile, bank or nominee; HR approves
- [ ] EM-09 Sanctioned vs filled posts per section and pay level
- [ ] EM-10 Bulk upload from Excel template (migration and new batches) with row-level validation
- [ ] S-10 Employee list (search, filter by section / type / level / status)
- [ ] S-11 Employee profile with tabs Personal · Job & Pay · Bank & IDs · Family · Documents · Service book · Leave · Payslips, and an Edit mode
- [ ] S-12 Service book entry · S-13 Change requests · S-14 Sanctioned posts
- [ ] History of every changed value kept (old → new, who, when)

## Module 3 — Recruitment & onboarding (§5)
- [ ] RO-01 Vacancy only against a vacant sanctioned post; Admin approves before advertising
- [ ] RO-02 Vacancy: post, level, seats, reservation break-up, advert no. & date, last date
- [ ] RO-03 Applicants one by one or Excel import; Applied → Eligible → Shortlisted → Selected → Waitlisted → Rejected
- [ ] RO-04 Selection list approved by Admin; appointment letter from template (Hindi + English)
- [ ] RO-05 Joining checklist: documents, medical, police verification, oath, bank, PAN, Aadhaar consent — each ticked with upload
- [ ] RO-06 "Complete joining" creates Employee ID, fixes initial pay, adds to next payroll pro-rata from DOJ
- [ ] RO-07 NPS (PRAN) registration data file for NPS joiners; EPF/ESIC registration data for contract joiners
- [ ] RO-08 Probation tracker, alert 30 days before end; confirmation into service book
- [ ] RO-09 Contract / daily-wage onboarding without vacancy (agency, wage rate, contract dates)
- [ ] Flow: Checker verifies documents & initial pay → Employee ID issued → login sent by SMS
- [ ] S-20 Vacancies · S-21 Applicants & selection · S-22 Joining

## Module 4 — Attendance & holidays (§6)
- [ ] AT-01 Import punches by device sync or daily CSV/Excel (eSSL, Mantra, ZKTeco, AEBAS layouts), validated before saving
- [ ] AT-02 Manual daily / monthly muster for sections without devices; HR enters, Checker checks
- [ ] AT-03 Daily status: Present, Absent, Half day, On leave, Holiday, On duty, Late
- [ ] AT-04 Missed-punch request by employee; reporting officer approves
- [ ] AT-05 Monthly lock by reporting officer (or HR) by the 25th; unexplained absence → leave or dies-non only after officer confirms
- [ ] AT-06 Days worked for contract / daily-wage workers feed wages
- [ ] AT-07 Dashboard: present, absent, late, on leave today by section
- [ ] AT-08 Holiday calendar: gazetted and restricted, set by HR each year
- [ ] S-30 Attendance · S-32 Holiday calendar

## Module 5 — Leave (§7)
- [ ] LV-01 Leave types, credits, caps and who can sanction held in an editable table (Admin approves changes)
- [ ] Default rules: CL 8/yr lapses 31 Dec · EL 15 on 1 Jan & 1 Jul, cap 300 · HPL 10 on 1 Jan & 1 Jul · Commuted = 2 HPL per day + medical cert · EOL no pay · Maternity 180 · Paternity 15 · CCL 730 in service · RH 2/yr
- [ ] LV-02 Automatic EL & HPL credit on 1 Jan / 1 Jul with caps (and pro-rata for joiners)
- [ ] LV-03 Apply, approve, reject, cancel online with live balance; mobile-friendly
- [ ] LV-04 Approved leave marks attendance and sets pay effect in next payroll
- [ ] LV-05 HR enters leave for staff who do not use the system
- [ ] LV-06 Opening balances from FoxPro / paper leave account
- [ ] LV-07 Leave ledger per employee (credits, debits, balance), printable for the service book
- [ ] Flow: beyond the officer's limit goes to HR or Admin
- [ ] S-31 Leave

## Module 6 — Rates & rules + monthly payroll (§8)
- [ ] PR-01 7th CPC pay matrix as a dated table (level × cell); a new commission matrix can be added with a new date
- [ ] PR-02 DA / HRA / TA dated rate table: DA 60% from 1 Jan 2026, HRA 30% (Delhi, X city), TA by level with DA on TA
- [ ] PR-03 Pay heads master (Basic, DA, HRA, TA, NPA, special, washing, uniform, conservancy, risk…) each with formula + account head
- [ ] PR-04 Deductions: GPF/CPF, NPS 10%, income tax, group insurance, licence fee, loans, court attachment, society dues, overpayment recovery
- [ ] PR-05 Pay groups: Permanent-OPS, Permanent-NPS, Contract & daily wage, Pensioners
- [ ] PR-10 Pre-checks: no bank account, negative net, pay after retirement, net change > 25%, duplicate bank account
- [ ] PR-11 Pay bill, schedules, acquittance roll, salary register (CBAR 2020 formats)
- [ ] PR-12 Bank file in bank's format; return file of failed credits imported and re-paid
- [ ] PR-13 Reopen only by Admin with a reason, only before bank file release
- [ ] PR-14 Accounting summary by account head for e-Chhawani
- [ ] S-81 Rates & rules (HR proposes, Admin approves, effective dates)
- [ ] S-40 Payroll month — five stages: Run → Fix exceptions → Check → Approve & sign (OTP) → Pay
- [ ] Worked example passes exactly: L6 C1 NPS Delhi → gross ₹73,020, NPS ₹5,664
- [ ] Full payroll run under 30 minutes (§16) — target: seconds

## Module 7 — Pay changes, arrears, loans & salary slips (§8)
- [ ] PR-06 Increment due list on 1 Jan / 1 Jul; HR confirms, Checker verifies, pay + service book updated
- [ ] PR-07 Pay fixation on promotion / MACP with the rule shown on screen
- [ ] PR-08 Arrears "due vs drawn" for any back period, paid in a supplementary bill
- [ ] PR-09 Loans & advances: sanction, schedule, interest, recovery stops at zero
- [ ] SL-01 PDF payslip: DCB name & logo, Employee ID, post, level & cell, bank last 4, PAN masked
- [ ] SL-02 Earnings, deductions, net in figures and words; leave balance; GPF/NPS balance
- [ ] SL-03 Hindi and English versions
- [ ] SL-04 Email + SMS link on credit day; employee downloads any past month (2 taps on phone)
- [ ] SL-05 Bulk download for a section as one ZIP or PDF
- [ ] S-41 Increments & fixation · S-42 Arrears & supplementary bills · S-43 Loans · S-44 Payslips

## Module 8 — Statutory & tax (§9)
- [ ] GPF ledger (min 6%, annual cap ₹5 lakh, advances, withdrawals, interest, annual statement)
- [ ] NPS employee 10% + employer share, CRA contribution file, CRA statement reconciliation
- [ ] Board pension fund 10% employer contribution for OPS staff (CBAR 2020)
- [ ] EPF 12% + 12% with ₹15,000 ceiling, EPS split, ECR file
- [ ] ESIC employee/employer shares, monthly contribution file
- [ ] Professional tax switch (off for Delhi)
- [ ] ST-01 Rates, ceilings and due dates as dated, editable tables
- [ ] ST-02 Tax regime per employee per year (new regime default)
- [ ] ST-03 Investment declarations + proofs before January, verified by HR & Accounts
- [ ] ST-04 Monthly TDS projected on full-year income, adjusted monthly and in Q4
- [ ] ST-05 Challan details against each month's TDS
- [ ] ST-06 Form 24Q quarterly file (Protean / TRACES FVU)
- [ ] ST-07 Form 16 Part B generated; Part A imported; both published to employee
- [ ] ST-08 Statutory calendar on dashboard, reminders 5 days before due
- [ ] ST-09 Every file previewed, Admin-approved, logged with checksum
- [ ] S-50 GPF & NPS · S-51 Tax declarations · S-52 Statutory files · S-53 Form 16

## Module 9 — Pension (§10)
- [ ] PN-01 Pensioner record: PPO, type, basic pension, commuted amount & date, DOB, bank, family
- [ ] PN-02 Pension payroll: basic + DR (= DA rate) + fixed medical allowance − commutation; same five stages
- [ ] PN-03 Commuted portion restored after 15 years automatically
- [ ] PN-04 Additional pension at 80 and later slabs
- [ ] PN-05 DR change → arrears for all pensioners in one job
- [ ] PN-06 Life certificate status (manual / Jeevan Pramaan upload), SMS reminder, pension held after one month overdue
- [ ] PN-07 Retirement alerts at 12 and 6 months; no-dues checklist per section
- [ ] PN-08 New pension case calculator: qualifying service, emoluments, pension, commutation, gratuity, leave encashment, GPF final, family pension
- [ ] PN-09 Case prepared (Pension), checked (Checker), approved (Admin); PPO PDF
- [ ] PN-10 Retiree moves to pensioner group the day after retirement; gratuity, commutation, encashment in supplementary bill
- [ ] PN-11 Death: pension stops, family pension next day, overpayment recovered
- [ ] PN-12 Pension slip by SMS / email; pensioner login with mobile + OTP
- [ ] All formulas as editable tables (pension %, commutation factors, gratuity, slab ages)
- [ ] S-60 Pensioners · S-61 Pension payroll · S-62 Pension case & PPO

## Module 10 — Reports, dashboards, migration & go-live (§11, §15, §16)
- [ ] Dashboards per login (Admin / HR & Accounts / Employee / Pensioner tiles per §11)
- [ ] 25 standard reports, filter by month, section, employee type; Excel + PDF export (S-70)
- [ ] Report 25 ghost-employee check
- [ ] S-90 Migration console: upload (incl. FoxPro .DBF), map, check, verify, parallel-run report, cut-over sign-off
- [ ] Migration checks table (§15): record counts, money totals, GPF, pension, duplicates, exceptions
- [ ] Parallel-run comparison: every difference > ₹1 listed per employee per head
- [ ] Data ownership: full export CSV / JSON (§16)
- [ ] Hardening: security headers, rate limits, CSP, backup & restore scripts, performance test (200 users), accessibility pass (GIGW 3.0 / WCAG 2.1 AA)
- [ ] Deployment guide for NIC MeghRaj / MeitY cloud (prod, test, training copies)

---

## Open questions carried from the PRD (§18) — built as settings, not code
- [ ] Headcount by type; number of pensioners / family pensioners
- [ ] FoxPro version and current maintainer
- [ ] Who approves payroll (CEO & DDO only, or also the Board President?) → Approver permission covers any of them
- [ ] Delegation of powers by amount → leave/loan limits are table values
- [ ] DCB-specific allowances and rates → pay heads master
- [ ] Salary bank and its bulk-file format → bank format setting + connector
- [ ] Biometric device make/model, AEBAS in use? → import column-mapping presets
- [ ] e-Chhawani summary format → export template
- [ ] Hindi typing method (Inscript / transliteration)
- [ ] Audit retention (assumed 8 years)
