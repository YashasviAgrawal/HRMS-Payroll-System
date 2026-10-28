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
- [x] Components: Button (one dark primary per screen), Input, Select, Textarea, Checkbox, Card, Badge, Tabs, Table (keyboard-first rows), Dialog, Toast, EmptyState, PageHeader, StatTile, Segmented, OTP input, Pagination, Skeleton — Stepper added with the payroll screen (Module 6)
- [x] Logo slot — drop the official file at `public/brand/logo.png`; placeholder emblem until then
- [x] Accessibility basics: focus rings, labelled fields, skip link, AA colours, rem sizing (§16) — _formal GIGW/WCAG pass done in Module 10 (axe: 0 violations on 128 screens)_

**Language**
- [x] Hindi / English switch on every screen incl. login (S-01, §16), remembered per user (S-03)

**Logins, sessions and permissions (§2)**
- [x] Three logins: Admin, HR & Accounts Manager, Employee (pensioners use Employee login)
- [x] Permissions Admin can tick: Approver · Pay bill signer · User & settings manager · HR · Payroll · Pension · Checker · Reporting officer
- [x] S-01 Login: Employee ID or mobile + password + OTP; employees and pensioners may use mobile + OTP only (rule 4)
- [x] OTP: 6 digits, 5-minute expiry, 5 tries, 30 s resend cool-down, 5 per 10 min; 5 wrong passwords lock 15 min; no account probing
- [x] Sessions time out after 15 minutes idle (rule 7) with a 2-minute warning; password change signs out other devices
- [x] Access ends automatically on retirement / resignation / transfer / death (rule 6) — _pensioner view from the day after retirement (Module 9)_
- [x] Access matrix (§14) coded as one permission table + scope (own record / own section) + unit tests for every cell
- [x] User & settings manager can never see pay, bank or Aadhaar (rule 3, §14 note); cannot be combined with Approver / Pay bill signer
- [x] Reporting officer sees only own section; scope is read from the person's employee record, so moving the person moves the access (rule 5)

**Shared platform services**
- [x] Audit trail: every create / edit / approve / print with user, time, IP, old and new value; cannot be edited (DB trigger) (§11, §16)
- [x] Outbox: every approved change writes an event (§12 rule 5)
- [x] Maker-checker engine: nobody approves their own entry (rule 1); nobody processes their own pay, loan or arrears (rule 2)
- [x] S-04 Approvals inbox: everything waiting for me, oldest first (+ raised by me, decided by me)
- [x] Connector framework (file now / API later) + SMS gateway (console mode / HTTP provider with DLT ids) (§12) — _email through the Board's SMTP server added with payslips (Module 7)_
- [x] Outgoing file registry: preview → Admin approves → SHA-256 checksum → audited download (ST-09) — _built in Module 3 with the PRAN and EPF/ESIC files_
- [x] Document storage (PDF / image ≤ 5 MB) with checksum — _built in Module 2 (EM-05)_

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
- [x] EM-01 One record per person, unique Employee ID; types: Permanent-OPS, Permanent-NPS, Contract, Daily wage, Re-employed, Deputation
- [x] EM-02 Job details: section, post, pay level & cell, DOB, DOJ; date of retirement auto-calculated (last day of month of turning the post's age; born on the 1st → previous month end); recalculated when DOB / post / type change
- [x] EM-03 PAN (individual "P"), Aadhaar (Verhoeff check, masked, AES-256 encrypted), PRAN/UAN, ESIC, bank account + IFSC; duplicates blocked at entry, at approval and by partial unique indexes in the database
- [x] EM-04 Family and nominees for GPF, gratuity, group insurance, family pension, NPS (shares add to 100% per scheme)
- [x] EM-05 Documents: PDF/JPG/PNG up to 5 MB, recognised by content, SHA-256 checksum, audited open/remove
- [x] EM-06 e-Service book: dated events with order no., date and attached order; timeline view
- [x] EM-07 Changes to pay level, bank or identity (and every other field) made by HR and approved by a Checker; old value kept in history
- [x] EM-08 Employee requests change to address, mobile, bank or nominee; HR approves (bank also needs a Checker); employee can withdraw
- [x] EM-09 Sanctioned vs filled posts per section and post, sanctioned strength changed through the Checker
- [x] EM-10 Bulk upload from Excel template (codes sheet, instructions) with row-level checks; all-or-nothing; one approval issues IDs; keeps FoxPro IDs when given
- [x] S-10 Employee list (search, filter by section / type / level / status incl. drafts and leavers)
- [x] S-11 Employee profile with tabs Personal · Job & Pay · Bank & IDs · Family · Documents · Service book · Leave · Payslips (+ History), and Edit mode per tab
- [x] S-12 Service book entry (Checker; appointment / promotion / penalty also Admin Approver) · S-13 Change requests · S-14 Sanctioned posts
- [x] History of every changed value kept (old → new, who made it, who approved it)
- [x] Self-service: My record (S-11 own, read-only), My requests, My team for reporting officers (own section only)
- [x] Full PAN / bank number can be revealed by HR, Checker, Payroll, Approver to check documents — every look audited; Aadhaar never shown in full

## Module 3 — Recruitment & onboarding (§5)
- [x] RO-01 Vacancy only against a vacant sanctioned post (seats ≤ sanctioned − filled − open vacancies − joinings in progress); Admin approves before advertising
- [x] RO-02 Vacancy: post, level, seats, reservation break-up (must add up to the seats), advert no. & date, last date; reference DCB/REC/YYYY/NNN
- [x] RO-03 Applicants one by one or Excel import (template, row-level errors); Applied → Eligible → Shortlisted → Selected → Waitlisted → Rejected; marks and merit rank recorded (exam is outside the system)
- [x] RO-04 Selection list (≤ seats, General-category selections ≤ unreserved seats) approved by Admin; appointment letter from template, Hindi page + English page, numbered `<ref>/APT/NN`, print audited
- [x] RO-05 Joining checklist: documents, medical, police verification, oath, bank, PAN, Aadhaar consent — each ticked by name and date, with an optional attached document
- [x] RO-06 "Complete joining" issues the Employee ID and fixes initial pay (level, cell 1) — _the pro-rata salary from the date of joining is worked out by the payroll run (Module 6), which reads the DOJ_
- [x] RO-07 NPS (PRAN) registration data file for NPS joiners without a PRAN; EPF/ESIC registration file for contract / daily-wage joiners without UAN/ESIC — both through the file registry (preview → Admin approves → checksum → download)
- [x] RO-08 Probation tracker (2 years − 1 day for direct recruits), alert 30 days before end on Home and in the list; confirmation recorded into the service book through the Checker
- [x] RO-09 Contract / daily-wage onboarding without vacancy (agency, wage rate and basis, contract dates)
- [x] Flow: Checker verifies documents & initial pay → Employee ID issued → APPOINTMENT entry in the service book → Employee login created → welcome SMS
- [x] S-20 Vacancies · S-21 Applicants & selection · S-22 Joining (+ Probation and Registration files tabs); applicant and list tables become cards on a phone

## Module 4 — Attendance & holidays (§6)
- [x] AT-01 Punch files from eSSL, ZKTeco (attlog.dat or export), Mantra and AEBAS, plus the Board's own template — read, checked line by line and shown before anything is saved; only new punches saved; file kept with SHA-256. Device sync: eSSL / ZKTeco push (ADMS) to `/iclock/cdata`, registered serial numbers only
- [x] AT-02 Muster roll for sections without devices, and HR corrections for any section — entered on the month register, sent as one batch to a Checker before they count
- [x] AT-03 Daily status: Present, Late, Half day, Absent, Missed punch, On duty, On leave, Holiday, Weekly off (+ Dies-non after the officer decides) — office start, grace and half-day time are settings
- [x] AT-04 Missed-punch / on-duty request by the employee (this month and last); the section's reporting officer decides (an officer's own request goes to HR); approved days are regularised
- [x] AT-05 Month lock by the reporting officer (own section) or HR (any section), due by the lock day (setting, 25th) for last month; blocked while requests or muster entries wait; every absent / missed-punch / half day must be decided (present, on duty or dies-non) before the lock; totals frozen for payroll; reopening goes to a Checker; "treat as leave" added in Module 5
- [x] AT-06 Days worked for contract and daily-wage workers are counted and frozen at lock (`AttendanceMonth.workedDays`); daily wages are paid on them in Module 6
- [x] AT-07 Today board: present, late, not in yet, on leave / duty, off — by section, with the list of people not in yet; Home tiles
- [x] AT-08 Holiday calendar per year (gazetted + restricted), set by HR and approved by a Checker; months already locked cannot change; working week (weekly off) and attendance mode per section
- [x] S-30 Attendance (Today · Month register · Month lock · Requests · Import) · S-32 Holiday calendar · My attendance (employee) · Team attendance (reporting officer)

## Module 5 — Leave (§7)
- [x] LV-01 Leave rules table (credit mode and days, cap, pay effect, lapse, half day, certificate, holidays counted, who may sanction); HR proposes a change or a new type, an Admin approves; every row versioned
- [x] Default rules: CL 8/yr lapses 31 Dec · EL 15 on 1 Jan & 1 Jul, cap 300 · HPL 10 on 1 Jan & 1 Jul · Commuted = 2 HPL per day + medical certificate · EOL no pay · Maternity 180 a time · Paternity 15 a time · CCL 730 in service · RH 2/yr from the RH list — _to confirm for DCB; CCL defaults to women employees_
- [x] LV-02 Automatic credits: EL & HPL on 1 Jan / 1 Jul (cap applied), CL & RH on 1 Jan after last year's balance lapses, pro-rata for new joiners (completed months, ½ rounds up); once per person per period, checked daily
- [x] LV-03 Apply with a live preview (days, balance after, who decides), approve / reject / send back, withdraw while waiting, cancel approved leave that has not started (HR can cancel any unlocked leave); works on a phone
- [x] LV-04 Approved leave marks attendance (source LEAVE, half days, holidays counted for EL-type leave) and the month totals carry leave on half pay (HPL) and no pay (EOL) for payroll; payable days = days on rolls − dies-non − no-pay leave
- [x] LV-05 HR enters leave sanctioned on paper (sanction order required); decided like any application
- [x] LV-06 Opening balances from an Excel sheet (one row per person, one column per leave; CCL as days used), checked line by line, approved by a Checker; also usable for one person
- [x] LV-07 Leave account per employee — credits, debits, running balance per leave — on screen and as a bilingual PDF for the service book
- [x] Flow: the section's reporting officer within their limit; an Admin beyond it, for leave the officer cannot sanction and for an officer's own leave (PRD §14 leave row)
- [x] Month lock: an unexplained day can be treated as leave (balance checked and debited) — completes AT-05
- [x] S-31 Leave (employee) · Team leave (reporting officer) · Leave for HR & Accounts (applications, balances, enter leave, opening balances, rules) · Home tiles (leave balance, leave waiting)

## Module 6 — Rates & rules + monthly payroll (§8)
- [x] PR-01 7th CPC pay matrix as a dated table (level × cell); a new commission matrix can be added with a new date (Excel upload → Admin approves)
- [x] PR-02 DA / HRA / TA dated rate table: DA 60% from 1 Jan 2026, HRA 30% (Delhi, X city), TA by level with DA on TA — plus the statutory rates (NPS, GPF, GIS, EPF, ESIC, pension fund)
- [x] PR-03 Pay heads master (Basic, DA, HRA, TA, NPA, special, washing, uniform, conservancy, risk…) each with formula + account head; changes and new heads through an Admin, versioned
- [x] PR-04 Deductions: GPF/CPF, NPS 10%, income tax, group insurance, licence fee, loans, court attachment, society dues, overpayment recovery — standing amounts per person as pay items, checked by a Checker
- [x] PR-05 Pay groups: Permanent-OPS (with deputation), Permanent-NPS, Contract & daily wage (with re-employed) — _the Pensioners group runs the pension bill (Module 9)_
- [x] PR-10 Pre-checks: no bank account, negative net, pay after retirement (or contract end), net change > 25%, duplicate bank account — plus no pay level, suspension and last month's attendance not locked
- [x] PR-11 Pay bill, schedules, acquittance roll, salary register as bilingual PDFs — _layouts to be matched to DCB's printed formats (PRD §18)_
- [x] PR-12 Bank file in the bank's format (generic, SBI CMP, PNB, BoB, Canara) through the file registry; return file of failed credits read; re-pay file
- [x] PR-13 Reopen only by Admin with a reason, only before bank file release
- [x] PR-14 Accounting summary by account head for e-Chhawani (balanced debit / credit CSV at month close, through the file registry)
- [x] S-81 Rates & rules (HR proposes, Admin approves, effective dates)
- [x] S-40 Payroll month — five stages: Run → Fix exceptions → Check → Approve & sign (OTP) → Pay
- [x] Pay items screen (standing allowances and deductions per person) · pay sheet per person · Home tile (pay groups approved this month) · approvals inbox opens the payroll to decide
- [x] Worked example passes exactly: L6 C1 NPS Delhi → gross ₹73,020, NPS ₹5,664
- [x] Full payroll run under 30 minutes (§16) — a pay group works out in well under a second for the demo Board

## Module 7 — Pay changes, arrears, loans & salary slips (§8)
- [x] PR-06 Increment due list on 1 Jan / 1 Jul (six months in the level; own record cannot be ticked; leave without pay flagged); HR & Accounts confirm, Checker verifies, pay history + service book updated, a future date waits for its day
- [x] PR-07 Pay fixation on promotion / MACP with the rule shown on screen — both options (from promotion / from the next increment date), Checker then Admin
- [x] PR-08 Arrears "due vs drawn" for any back period (rates, increments, fixation), month by month, paid in a supplementary bill that goes through the same five stages; also bills for pay withheld earlier and for joiners
- [x] PR-09 Loans & advances: sanction (Checker + Admin), schedule, simple interest after the principal, recovery through payroll recorded on approval and undone on reopen, stops at zero
- [x] SL-01 PDF payslip: DCB name & logo, Employee ID, post, level & cell, bank last 4, PAN masked
- [x] SL-02 Earnings, deductions, net in figures and words; leave balance; NPS to date and GPF this year from the pay bills — _full GPF / NPS ledgers with interest in Module 8_
- [x] SL-03 Hindi and English versions
- [x] SL-04 Email (PDF attached, Board SMTP) + SMS link on credit day (bank file released); employee downloads any past month (2 taps on phone)
- [x] SL-05 Bulk download for a bill or one section as one PDF
- [x] S-41 Increments & fixation · S-42 Arrears & supplementary bills · S-43 Loans · S-44 Payslips (HR & Accounts and My payslips)

## Module 8 — Statutory & tax (§9)
- [x] GPF ledger (min 6%, annual cap ₹5 lakh, advances, withdrawals, interest, annual statement) — _GPF final payment on retirement in Module 9_
- [x] NPS employee 10% + employer share, CRA contribution file, CRA statement reconciliation
- [x] Board pension fund 10% employer contribution for OPS staff (CBAR 2020)
- [x] EPF 12% + 12% with ₹15,000 ceiling, EPS split, ECR file
- [x] ESIC employee/employer shares, monthly contribution file
- [x] Professional tax switch (off for Delhi)
- [x] ST-01 Rates, ceilings and due dates as dated, editable tables
- [x] ST-02 Tax regime per employee per year (new regime default)
- [x] ST-03 Investment declarations + proofs before January, verified by HR & Accounts
- [x] ST-04 Monthly TDS projected on full-year income, adjusted monthly and in Q4
- [x] ST-05 Challan details against each month's TDS
- [x] ST-06 Form 24Q quarterly file (Protean / TRACES FVU) — _layout to be run through the FVU before the first filing (PRD §18)_
- [x] ST-07 Form 16 Part B generated; Part A imported; both published to employee
- [x] ST-08 Statutory calendar on dashboard, reminders 5 days before due
- [x] ST-09 Every file previewed, Admin-approved, logged with checksum
- [x] S-50 GPF & NPS · S-51 Tax declarations · S-52 Statutory files · S-53 Form 16

## Module 9 — Pension (§10)
- [x] PN-01 Pensioner record: PPO, type, basic pension, commuted amount & date, DOB, bank, family — _additions from the old records and every change go to a Checker_
- [x] PN-02 Pension payroll: basic + DR (= DA rate) + fixed medical allowance − commutation; same five stages — _pay group "Pensioners": OTP approval, bank file to the pensioner's account by PPO, prints, close; months not yet paid here are caught up on the next slip; TDS on own pension_
- [x] PN-03 Commuted portion restored after 15 years automatically — _by days in the month of restoration; 29 Feb → 1 Mar_
- [x] PN-04 Additional pension at 80 and later slabs — _from the 1st of the month of turning 80 / 85 / 90 / 95 / 100, on basic pension, DR on both_
- [x] PN-05 DR change → arrears for all pensioners in one job — _due vs drawn for the months paid, one supplementary pension bill_
- [x] PN-06 Life certificate status (manual / Jeevan Pramaan upload), SMS reminder, pension held after one month overdue — _November cycle; upload checked by Pension in Approvals; the bill holds by itself and pays the held months next time_
- [x] PN-07 Retirement alerts at 12 and 6 months; no-dues checklist per section — _alerts on the case screen and in Home "My work"; dues recovered from the benefits_
- [x] PN-08 New pension case calculator: qualifying service, emoluments, pension, commutation, gratuity, leave encashment, GPF final, family pension — _from the service book, approved pay bills, leave ledger, GPF ledger; NPS staff: gratuity and leave encashment_
- [x] PN-09 Case prepared (Pension), checked (Checker), approved (Admin); PPO PDF — _bilingual PPO stored at approval for physical signature_
- [x] PN-10 Retiree moves to pensioner group the day after retirement; gratuity, commutation, encashment in supplementary bill — _leaves the rolls (status, service book), GPF account closed_
- [x] PN-11 Death: pension stops, family pension next day, overpayment recovered — _pensioner or employee in service; recovery from family pension (≤ ⅓ a month) or from the benefits_
- [x] PN-12 Pension slip by SMS / email; pensioner login with mobile + OTP — _retirees keep their login; family pensioners get their own; Home, slips, life certificate, record_
- [x] All formulas as editable tables (pension %, commutation factors, gratuity, slab ages) — _dated rates (Pension group) + dated commutation table through Admin approval_
- [x] S-60 Pensioners · S-61 Pension payroll · S-62 Pension case & PPO

## Module 10 — Reports, dashboards, migration & go-live (§11, §15, §16)
- [x] Dashboards per login (Admin / HR & Accounts / Employee / Pensioner tiles per §11) — _Admin: headcount by type, salary and pension cost, payroll stage per pay group, approvals, retirements in 6 months, statutory due dates; HR & Accounts: My work, locks open, payroll exceptions, leave waiting, joiners / leavers, life certificates overdue; Employee: last net pay, leave balance, next increment, requests waiting; Pensioner: last pension, life certificate_
- [x] 25 standard reports, filter by month, section, employee type; Excel + PDF export (S-70) — _open to a login with Reports **and** the view right of what the report reads (§14); reporting officers see their own section; every download is in the audit trail; payroll reports read approved bills only_
- [x] Report 25 ghost-employee check — _same Aadhaar / PAN / bank among current staff (the database already refuses it), a salary account that also takes someone else's pension, two pensions into one account, pay or pension after retirement / leaving / death, pay with no attendance in the month the bill read_
- [x] S-90 Migration console: upload (incl. FoxPro .DBF), map, check, verify, parallel-run report, cut-over sign-off — _files kept with SHA-256 (step 1); .DBF + .FPT read without outside libraries, CSV and Excel too, deleted rows kept apart (2–3); mapping sheet per target suggested from FoxPro column names, code lists, Kruti Dev → Unicode, signed off by Accounts (4); values cleaned with the original kept, or explained in writing (5); identity and past-retirement flags (6); service book · own confirmation (online or signed sheet) · Checker lock (7); employees, leave, GPF, loans, tax paid, pensioners loaded through Checkers, never twice (8); Admin signs the cut-over, the console turns read-only (10)_
- [x] Migration checks table (§15): record counts, money totals, GPF, pension, duplicates, exceptions — _worked out from the data; signed by the people the PRD names, only while passing; the figures are kept with each signature_
- [x] Parallel-run comparison: every difference > ₹1 listed per employee per head — _FoxPro pay sheet (one row per head, or one column per head) against the month's bills; each difference explained; three explained months in a row allow the cut-over_
- [x] Data ownership: full export CSV / JSON (§16) — _every table, Admin only, logged; no sign-in secrets; Aadhaar / PAN / bank stay encrypted_
- [x] Hardening: security headers, rate limits, CSP, backup & restore scripts, performance test (200 users), accessibility pass (GIGW 3.0 / WCAG 2.1 AA) — _nonce CSP + HSTS, 429 limits per address and session, `no-store` API, trusted client address; backup → restore drill identical; 200 users: 0 errors, 95% under 0.33 s; payroll for 1,675 staff + 1,255 pensioners in 1.7 s; slow-4G pages under 3 s; axe 0 violations on 128 screens, nothing scrolls sideways at 320 px; screens read the dated pay matrix_
- [x] Deployment guide for NIC MeghRaj / MeitY cloud (prod, test, training copies) — _[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): sizing, copies, server, NIC/NPL time, PostgreSQL + WAL, keys, systemd, nginx, backups, logs, go-live checklist, controls for the auditor_

---

## Client add-ons (DCB review after the FoxPro walk-through)
- [x] C1 One employee, one screen — profile Overview: service, leave balances, attendance, salary, payslips, loans, GPF (by rights)
- [x] C2 Suspension and leaving service (resignation, removal, dismissal, termination, contract end, transfer out) with a full and final settlement that takes every outstanding loan and recovery — _HR records with the order, Checker + Admin approve; reinstatement the same; the statement (withheld pay, leave encashment by kind of leaving, every loan with interest, pay drawn after the last day, instalments still to come, lines by order) goes to a Checker and an Admin; the net is paid by a settlement bill whose approval closes the loans and the GPF account, or the person pays back the excess receipt by receipt; statement PDF_
- [x] C3 Arrears of a DA rate / increment paid late, worked out by days when the change falls inside a month
- [x] C4 DA and transport allowance (with DA on it) year by year, with each revision's step
- [x] C5 Scanned service books of existing staff — one at a time or many at once, filed by Employee ID in the file name
- [x] C6 Bank salary file as Excel (text file kept as a setting)
- [x] C1a The Admin sees everything — Employees, Attendance and leave, Pension in the Admin menu; an Administration page for the admin tools; last net pay on the employee list; a "find an employee" box in the top bar
- [x] C7 Document types as a setting (names in English and Hindi, largest size, in use) — the Board confirms its list

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
