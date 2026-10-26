# Progress & change log

This file records **what has changed, what was verified, and what is still pending**.
The module checklist with PRD IDs is in [PLAN.md](./PLAN.md).

## Status at a glance

| # | Module | Status |
|---|--------|--------|
| 1 | Foundation & platform | 🟢 Done & verified (2 items carried to later modules, see PLAN.md) |
| 2 | Employee master | 🟢 Done & verified |
| 3 | Recruitment & onboarding | 🟢 Done & verified |
| 4 | Attendance & holidays | 🟢 Done & verified |
| 5 | Leave | 🟢 Done & verified |
| 6 | Rates & rules + monthly payroll | 🟢 Done & verified (Pensioners pay group in Module 9) |
| 7 | Pay changes, arrears, loans & salary slips | 🟡 Next |
| 8 | Statutory & tax | ⚪ Pending |
| 9 | Pension | ⚪ Pending |
| 10 | Reports, dashboards, migration & go-live | ⚪ Pending |

🟢 Done & verified · 🟡 In progress · ⚪ Pending

---

## Change log (newest first)

### 2026-10-26 — Module 6: Rates & rules + monthly payroll ✅
**Built**
- Schema: PayMatrix (dated, level → cells), PayRate (dated rates), PayHead (formula, posts, account head, versioned),
  EmployeePayItem (standing amounts per person), PayrollRun (one per pay group and month, five stages), Payslip (every
  head as a line, days, bank last 4, change against last month, credit status), PayrollException (PR-10 with resolution).
- Pure pay engine (`modules/payroll/engine.ts`): Basic from the matrix, NPA, DA, HRA (with the minimum), TA by level with DA
  on TA, fixed post allowances, wages (monthly or days worked), NPS / GPF / GIS / EPF / ESIC and employer shares, standing
  items; pro-rata for days on the rolls; last month's dies-non and no-pay leave cut pay, half-pay leave halves Basic and DA
  (D-17). Each head rounded to the rupee.
- S-81 Rates and rules: rates with history and future-dated values, pay heads, the pay matrix (current matrix as an Excel
  template; a new commission's matrix uploaded from Excel). HR & Accounts propose; an Admin approves every change.
- Pay items: Payroll adds or ends a standing allowance or deduction (GPF subscription, licence fee, TDS, society, loan
  instalment, court attachment, recovery…); a Checker checks it.
- S-40 Payroll month: Run (works out a pay group in well under a second) → Fix exceptions (no bank, negative net, pay after
  retirement or contract end, duplicate bank account, no pay level, suspended, last month not locked, net change over 25%;
  fix the record and work it out again — remarks carried over — or withhold / explain / waive) → Check (Checker reviews
  totals by section and every change over 25%, forwards or returns with remarks; the maker can take it back) → Approve
  and sign (Admin with Pay bill signer, OTP to their mobile tied to that payroll) → Pay (bank file through the file
  registry, released by an Admin; the bank's return file marks failed credits; re-pay file; month close builds the
  accounting summary). PR-13 reopen by an Admin with a reason until the bank file is released.
- Prints (PR-11): pay bill (abstract by head with account heads, amount in words, certificates, maker / checker / signer /
  DDO), salary register by section (landscape), one schedule per recovery head (with PRAN / GPF / UAN), acquittance roll —
  bilingual PDFs with a DRAFT band until approval.
- Bank files (PR-12) in five layouts (generic CSV, SBI CMP, PNB, BoB, Canara) chosen in System settings; return-file
  template; accounting summary (PR-14) balanced debit / credit by account head.
- Approvals inbox: payroll tasks open the payroll screen to decide (the OTP lives there); the inbox cannot approve a payroll
  without it. Home tile "Pay groups approved this month".
- Seed: 7th CPC matrix, PRD rates (DA 58% from Jul 2025, 60% from Jan 2026), pay heads for every installation; demo pay
  items and the last two months closed for all three pay groups — this month is left to run (Health's unlocked
  September and a one-off recovery show the exceptions).

**Verified**
- 251 unit + integration tests (26 new: the pay engine with the PRD worked example, pre-checks, bank and return files; on a real database: the worked example on OPS,
  loss days from locked attendance, blocked hand-over until exceptions are resolved, own pay refused, resolutions kept on a
  re-run, Checker return / forward and take-back, OTP-only approval, reopen before and not after release, bank file
  content, return-file mismatch, re-pay, balanced accounting summary, rate and pay-item approvals), typecheck, lint, build.
- 25 Playwright checks (3 new: the whole five-stage month with four logins, a DA change through an Admin, a pay item through
  a Checker; every payroll screen fits a phone).
- Every PDF checked by eye; screens reviewed in English, Hindi and on a phone.

**Fixed while verifying**
- Demo contracts ended in 2025, which flagged contract staff as paid after their contract end — they now run to 31 March
  2027 like the Board's yearly renewals.
- Signatures on the pay bill and acquittance roll no longer fall alone onto a second page.

### 2026-10-26 — Module 5: Leave ✅
**Built**
- Schema: LeaveType (the rules table, versioned), LeaveLedger (opening, credit, debit, lapse, restored — one credit per
  person, leave and period), LeaveApplication (with certificate, paper sanction); attendance day links to its application;
  month totals carry half-pay and no-pay leave.
- Pure leave rules: counting days (CL skips holidays and weekly offs, EL counts them), credit periods, pro-rata for new
  joiners, the EL cap, who decides. Default rules from the PRD table, loaded for every installation.
- Automatic credits (LV-02) checked once a day per Board when leave is looked at; last year's CL and RH lapse first.
- Apply with live preview (LV-03), commuted leave from HPL × 2 with a certificate, RH only on RH-list days, maternity and
  paternity per spell, CCL against 730 days in service; overlaps, locked months and short balances refused.
- Approval marks the days and debits the balance (LV-04); cancel restores both. HR paper-sanction entry (LV-05), opening
  balances from Excel through a Checker (LV-06), leave account on screen and as a bilingual PDF (LV-07), rules changes
  through an Admin (LV-01).
- Month lock now offers "treat as leave" with the person's balances (AT-05 complete).
- Screens: Leave (employee), Apply, Application, Leave account, Team leave, Leave for HR & Accounts (5 tabs), an
  Attendance / Leave switch for the shared menu item, Home tiles.
- Demo data: opening balances, credits for 2026, three approved leaves (EL, HPL, CL) with their days marked, and two
  applications waiting — one for Health's reporting officer, one for an Admin.

**Verified**
- 225 unit + integration tests (15 new: day counting, credits and pro-rata, cap, routing; on a real database: credits once,
  live preview, officer approval and cancellation, opening balances through a Checker, Admin for long leave, commuted
  leave with certificate, HR paper entry, rules change through an Admin, leave decided at the month lock with its pay
  effect), typecheck, lint, build clean.
- 21 Playwright checks (3 new leave flows; every leave screen fits a phone).
- Leave account PDF checked (Hindi headings, running balances). Screens reviewed in English, Hindi and on a phone.

**Fixed while verifying**
- Leave entered by HR now goes to the section's officer or an Admin, not a Checker — PRD §14 gives the Checker no role
  in leave (caught when the Checker could not open the leave screens).
- The live "balance after" now allows for applications already waiting.

### 2026-10-26 — Module 4: Attendance & holidays ✅
**Built**
- Schema: Holiday, AttendancePunch, AttendanceImport, AttendanceDay, AttendanceRequest, AttendanceLock, AttendanceMonth;
  Section attendance mode and weekly off; Employee biometric ID (unique per Board, on the Job & Pay tab).
- Pure rules module: a day's status from saved entry → calendar → punches → nothing; month totals with payable days
  (days on the rolls − dies-non) and days worked; shared by the service, the screens, the seed and the tests.
- Punch import (AT-01): five formats matched by column headings, line-level errors, unknown IDs, locked months, future
  dates and duplicates reported before saving; device push endpoint for eSSL / ZKTeco (ADMS) limited to registered devices.
- Muster and HR corrections (AT-02) on the month register, sent to a Checker as one batch; pending entries shown dashed.
- Missed-punch / on-duty requests (AT-04) routed to the section's reporting officer (HR for the officer's own).
- Month lock (AT-05): blockers, a decision for every unexplained day, frozen totals, reopening through a Checker.
- Today board (AT-07), holiday calendar with Checker approval and working week per section (AT-08), Settings card for
  office hours, grace, half-day time, weekly off and devices; Home "My work" item and tiles for locks due.
- Screens: Attendance (5 tabs), Lock attendance, Holiday calendar, My attendance (calendar + requests), Team attendance.
- Demo data: 2026 holiday list (to be checked against the government order), two months of punches, a muster-roll
  section, last month locked except Health (left for its officer), a missed-punch request waiting for him.

**Verified**
- 210 unit + integration tests (24 new: rules, file formats, import, request routing, section scope, muster, lock and
  reopen, holidays and locked months, device push), typecheck, lint, build clean.
- 18 Playwright checks: punch file check → save; request → officer approves → officer decides and locks last month;
  muster correction → Checker; next year's calendar → Checker; every attendance screen fits a phone (no sideways scroll).
- Screens reviewed in English, Hindi and on a phone.

**Fixed while verifying**
- Screen-reader labels inside the register widened the whole page; scroll boxes now contain them (`relative`).
- Payable days / days worked stay pinned on the right of the register on wider screens.
- Browser checks reuse one session per login for the run (the 5-OTPs-in-10-minutes rule stays as it is).

### 2026-10-26 — Module 3: Recruitment & onboarding ✅
**Built**
- Schema: Vacancy (reservation break-up, advert, selection status), Applicant (marks, merit rank, appointment letter no.),
  Joining (checklist with who/when/document per item, one joining per draft employee).
- Vacancy against a vacant sanctioned post only (sanctioned − filled − open vacancies − joinings in progress), Admin
  approval before advertising, reference `DCB/REC/YYYY/NNN`, close vacancy.
- Applicants one by one or from an Excel template with row-level errors; status, marks and merit rank per row.
- Selection list to the Admin (seats and unreserved-seat rules checked); bilingual appointment letter PDF (Hindi page,
  English page, letterhead, pay in figures and words, terms, CEO signature), every print audited.
- Joining: draft employee created from the applicant (NPS for joiners after 2004, cell 1, probation 2 years − 1 day),
  7-item checklist, ID/bank check, "Complete joining" → Checker → Employee ID, APPOINTMENT service-book entry, Employee
  login and welcome SMS. Direct onboarding for contract and daily-wage workers (RO-09).
- Probation tracker with the 30-day alert (Home tile + list) and confirmation through the Checker into the service book.
- Outgoing file registry (ST-09) first used here: PRAN registration CSV and EPF/ESIC registration file → preview →
  Admin approves → SHA-256 checksum → audited download.
- Tables marked `stack` turn into one card per row on phones (applicants, vacancies, joinings, probation, files).

**Verified**
- 186 unit + integration tests (recruitment flow end to end on a real database), typecheck, lint, build clean.
- 13 Playwright checks, now on their own database (`hrms_e2e`, rebuilt and seeded each run, server on :3100):
  vacancy → Admin approval → advert → applicants → selection → Admin approval → letter → joining checklist → Checker →
  Employee ID; new phone check that no main HR or employee screen scrolls sideways.
- Appointment letter PDF checked page by page (Hindi shaping, amount in words, letter number).
- Screens reviewed in English, Hindi and on a phone.

**Fixed while verifying**
- A blank number in a form (marks, wage rate, pay cell) was saved as 0 — blank now stays blank (`optionalNumber`).
- Card header buttons could push a phone screen sideways — they now wrap (guarded by the new phone check).
- Vacancy title showed a bare seat count; a finished joining still said "draft record"; pay cell had no label.
- Demo data: probation now applies to permanent staff only (the CEO is on deputation); one teacher's probation ends
  within 30 days so the alert can be seen.

### 2026-10-26 — Module 2: Employee master ✅
**Built**
- Schema: full employee record (personal, addresses, identity and bank — encrypted with blind indexes, contract fields,
  probation), FamilyMember, Nominee, EmployeeDocument, ServiceBookEntry, EmployeeFieldHistory, SanctionedPost; partial
  unique indexes so duplicate PAN / Aadhaar / bank among current staff are impossible even at database level.
- 7th CPC pay matrix generator (every level's official maximum verified) used to show Basic pay.
- New employee = draft → Checker approves → Employee ID issued (RO flow step 4). Drafts are corrected in place.
- Edits per tab go to a Checker with old → new rows; one pending change per record; maker can withdraw; history kept.
- Family & nominees (100% per scheme), documents (content-sniffed, 5 MB, checksum), e-service book with order upload
  and Checker → Approver chain for appointment / promotion / penalty.
- Employee self-service requests (address, mobile, bank, nominee) with HR approval; bank change continues to a Checker.
- Sanctioned vs filled (S-14), change requests queue (S-13), bulk Excel upload (EM-10) with template and row checks.
- Screens: list, 4-step add form, profile with 9 tabs, edit forms, approvals with reveal of proposed numbers, My record,
  My requests (with withdraw), My team.

**Verified**
- 182 unit + integration tests (14 new employee-master flows on a real database), typecheck, lint, build clean.
- Browser checks: HR adds an employee in 4 steps → Checker approves → Employee ID shown; employee asks for an address
  change; all Module 1 checks still pass (10/10).
- Screens reviewed in English, Hindi and on a phone.

**Fixed while verifying**
- Approval kinds were only registered on routes that imported the approvals entry point — the engine now loads them itself
  (caught by the browser check of the employee request).

### 2026-10-26 — Module 1: Foundation & platform ✅
**Built**
- Prisma 7 + PostgreSQL schema for the platform: Board (multi-Board ready), Section, Post, Employee (core), User, Session,
  OtpChallenge, AuditLog (append-only DB trigger), OutboxEvent, ApprovalTask, Setting, Sequence, FileRecord, MessageLog.
- Sign-in (S-01): three logins; ID/mobile + password + OTP; mobile + OTP only for employees and pensioners; OTP expiry,
  attempt limits, resend cool-down, 10-minute request cap; password lockout; no account probing; access ends with the job.
- Sessions: hashed tokens in the database, 15-minute idle timeout with a 2-minute warning and keep-alive while typing.
- Access matrix (PRD §14) as data + menus (§13, max 8 items) + section scope for reporting officers.
- Maker-checker engine and Approvals inbox (S-04): own-entry and own-pay rules, chains, audit + outbox on every decision.
- Audit trail (S-71), Users & permissions (S-80), Settings (S-82), My profile (S-03), Home (S-02).
- Design system (white + green), Hindi/English everywhere, phone layout with bottom bar, placeholder pages for screens of
  later modules, security headers, encrypted backup/restore scripts, README with demo logins.

**Verified**
- `npm run typecheck`, `npm run lint`, `npm run build` — clean.
- 163 unit + integration tests: money rounding and words (EN/HI), retirement-date rule, every cell of the §14 matrix,
  menus, Hindi/English key parity, access-end rule, OTP sign-in, lockout, own-entry / own-pay rules, section scope,
  audit immutability, users service, settings-manager blindness to sensitive data.
- 9 Playwright browser checks (desktop + phone): sign-in in EN/HI, wrong password, OTP sign-in for each login,
  menus per permission, users/settings/audit screens, mobile OTP sign-in on a phone.
- Screens reviewed by screenshot on desktop and phone, English and Hindi.

**PRD alignment notes**
- A Checker sees Payroll, Statutory and Pension menus because §14 gives Checker "K" (check) there — checking needs viewing.
- Mobile + OTP-only sign-in is offered to the Employee login only, as §2 rule 4 says.

### 2026-10-26 — Project start
- Read the Release 1 PRD end to end (24 pages) and split it into 10 modules (see PLAN.md).
- Scaffolded Next.js 16.3 + TypeScript + Tailwind v4.
- Created `PLAN.md` (module checklist with PRD IDs) and this file.

---

## Pending / next up
- Module 7: Pay changes, arrears, loans & salary slips (PR-06…09, SL-01…05, S-41…44): increment due list, pay fixation on
  promotion / MACP, arrears "due vs drawn" (a past-dated DA order now starts them), supplementary bills (pay withheld at a
  pre-check, joiners missed by the regular bill, subsistence allowance), loans with recovery stopping at zero, payslips in
  Hindi and English with email / SMS.
- Carried items: pensioner view and the Pensioners pay group (Module 9); email sending (Module 7); employee screens still
  show Basic from the built-in 7th CPC table while payroll reads the dated matrix — moves to the dated table with pay
  fixation (Module 7); reports 7–19 and the formal accessibility pass (Module 10); leave encashment (Module 9).

## Decisions taken (and why)
| # | Decision | Reason |
|---|----------|--------|
| D-01 | Next.js full-stack (screens + REST API in one app) instead of the PRD's suggested Django | Client choice; PRD §12 rule 4 (REST APIs used by the screens) still met — every module exposes `/api/v1/...` |
| D-02 | Screens read data on the server through the same service layer the REST API uses; every write from a screen calls the REST API | One code path for permission checks, audit and outbox |
| D-03 | Money in `Decimal(14,2)`, maths in integer paise, each pay head rounded to the nearest rupee (50 paise and up rounds up) | Government practice; needed for ±₹1 match with FoxPro |
| D-04 | Aadhaar / PAN / bank account encrypted with AES-256-GCM; an HMAC blind index lets us block duplicates without decrypting | EM-03, §16 security |
| D-05 | Hindi PDFs (payslip, PPO, pay bill) rendered from HTML by headless Chromium | Correct Devanagari shaping; PDF libraries break Hindi conjuncts |
| D-06 | "Nobody processes their own pay" enforced per record: a user can't prepare, fix, check or approve any item whose subject is their own employee record | §2 rule 2 without blocking the whole monthly run in a small office |
| D-07 | Retirement date: last day of the month in which the employee turns the retirement age; if born on the 1st, the last day of the previous month (FR 56) | EM-02; matches central rules |
| D-09 | `APP_ENV` (development / test / training / production) is separate from `NODE_ENV` | PRD §16 asks for separate production, test and training copies; OTP-on-screen helper never runs in production |
| D-10 | The User & settings manager permission cannot be combined with Approver or Pay bill signer | Keeps §2 rule 3 absolute — that person can never see pay |
| D-11 | A person may hold one login of each type (e.g. HR clerk also has an Employee login for own payslip); the login type is chosen on the sign-in screen | §2 has three logins; staff in HR still need self-service |
| D-12 | Every employee-record change (not only pay/bank/identity) goes to a Checker | PRD §4 intro: "Changes go through maker-checker and keep their old value in history" |
| D-13 | Bulk upload is all-or-nothing and goes to the Checker as one batch | Migration safety: no half-loaded files; one decision issues all IDs |
| D-14 | HR, Checker, Payroll and Approver can reveal a full PAN / bank number (audited); Aadhaar is never shown in full | Checkers must compare numbers with documents; Aadhaar Act limits display |
| D-15 | Browser checks run against their own database (`hrms_e2e`) and server (:3100), rebuilt and seeded on every run | Repeatable runs that never touch the demo data; set `BASE_URL` to point them at another copy |
| D-16 | Exam / interview marks are entered as results only; the exam itself is outside the system | PRD §5 covers the vacancy → joining flow, not running the exam |
| D-17 | Attendance month = calendar month; last month is locked by the lock day (25th) of this month, and that month's payable days feed this month's pay bill | Locks a complete month, gives 25 days to regularise missed punches, matches "attendance locked by the 25th" as step 1 of the monthly payroll flow (PRD §8). Configurable lock day |
| D-18 | Punches are stored raw; a day's status is worked out when shown and saved only for decisions (muster, request, lock) | One source of truth; a late file or a corrected rule changes unlocked days without data repair |
| D-19 | Office hours default to central government hours in Delhi (09:00, 15 min grace, half day under 4 h, Sat–Sun off; six-day week for health, water, hospital and gardens in the demo) | PRD §18 asks to confirm DCB's rules; all are settings, not code |
| D-20 | Unexplained days at lock: present, on duty or dies-non now; "treat as leave" arrives with the Leave module | PRD AT-05 needs the officer's decision before any pay effect; leave debits need the leave ledger |
| D-21 | Leave balances live in a ledger (sum of entries), never in a stored number | The printed leave account and the balance can never disagree; corrections are new entries |
| D-22 | Leave credits run when leave is first looked at each day (and are safe to repeat), not by a separate scheduler | No extra process to run on the Board's server; a per-person, per-period key stops double credits |
| D-23 | Leave decisions follow PRD §14: reporting officer (own section, within the limit set per leave type), Admin beyond it, for leave without an officer and for officers' own leave; HR paper entries follow the same route; opening balances (migration) go to a Checker | The Checker has no role in the §14 leave row; migration has |
| D-24 | A month's pay uses the matrix and rates in force on the 1st of that month; a past-dated change never rewrites a closed month — it becomes arrears (PR-08, Module 7) | Closed pay bills stay exactly as signed |
| D-25 | Approve and sign = an Admin holding Pay bill signer and Approver, with an OTP tied to that one payroll; the approval kind itself checks the OTP was just used, so no other screen can approve a payroll | PRD §8 flow step 5; one OTP cannot sign another bill |
| D-26 | The salary bank file is released by an Admin through the file registry (ST-09); that release is the PR-13 line — reopen is possible until then, never after | "Before the bank file is released" made precise and enforceable |
| D-27 | Blocking pre-checks are fixed in the record (then "work out again", remarks carried over) or the person's pay is withheld and paid in a supplementary bill; a section that has not locked last month can be paid without its loss days (recovered next month) or held; a net change over 25% needs a remark | Lets the month go out on time without hiding any exception from the Checker |
| D-28 | Re-employed pensioners are paid in the Contract pay group on their wage rate; their contract end (not the old retirement date) is the end of pay | PR-05 has four groups; re-employed staff are on contract terms |
| D-08 | Delhi Cantt logo could not be downloaded from inside the build environment (network policy). A placeholder emblem sits at `public/brand/logo.svg`; drop the real logo at the same path | — |

## Known gaps / risks
- Exact bank bulk-file, CRA contribution, e-Chhawani and Form 24Q layouts, the pay bill / register / schedule formats (CBAR 2020) and the e-Chhawani account heads must be confirmed against real samples before go-live (PRD §18 open questions). They are built as switchable templates.
- Leave, pension and tax defaults follow central rules and are marked "to confirm for DCB" in the rules tables.
