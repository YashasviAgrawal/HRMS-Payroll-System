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
| 6 | Rates & rules + monthly payroll | 🟢 Done & verified |
| 7 | Pay changes, arrears, loans & salary slips | 🟢 Done & verified |
| 8 | Statutory & tax | 🟢 Done & verified (24Q / CRA / ECR / ESIC layouts to check with one real upload — PRD §18) |
| 9 | Pension | 🟢 Done & verified (rules and the PPO layout to confirm for DCB — PRD §10, §18) |
| 10 | Reports, dashboards, migration & go-live | 🟡 In progress — reports and dashboards done; migration console, hardening and go-live next |

🟢 Done & verified · 🟡 In progress · ⚪ Pending

---

## Change log (newest first)

### 2026-10-27 — Module 10 (part 1): Reports and dashboards ✅
**Built**
- S-70 Reports: the 25 standard reports of PRD §11 in six areas — Employees (1 employee list, 2 headcount by section and
  type, 3 sanctioned vs filled, 4 retirements and probation due, 5 missing PAN / Aadhaar / bank / PRAN / UAN / GPF no.,
  6 recruitment by vacancy), Attendance and leave (7 monthly register with the muster codes, 8 absent and late with the
  dates, 9 leave balances at the month end from the ledger, 10 leave taken by type — a leave crossing the month end is
  split by its own counting rule), Payroll (11 salary register head by head, 12 pay bill abstract by head and account
  head with links to the printed bills and schedules, 13 acquittance roll, 14 salary cost by section with the Board's
  share, 15 month-on-month change with the heads that moved, 16 deductions by head and pay group, 17 loans outstanding
  after the month's recovery, 18 arrears statement due vs drawn by month, 19 bank credits, failures and re-payments),
  Statutory and tax (20 GPF ledger and annual statement — open a person for the PDF, 21 NPS with missing PRAN flagged,
  22 EPF and ESIC, 23 TDS deducted vs deposited by month with each quarter's 24Q state), Pension (24 pension register
  with the month's pay and life certificate status) and Control (25 ghost-employee check).
- Every report filters by month, section and employee type (where they apply), shows totals, opens on the right month
  (payroll reports on the last approved bill, the pension register on the last pension bill) and downloads as Excel
  (numbers stay numbers, frozen header) or PDF (A4, landscape when wide, Hindi or English) — exactly what is on screen.
  Downloads are recorded in the audit trail. Wide tables keep the first column in view; phones get cards.
- Access follows §14: a report opens for a login with the Reports right and the view right of the function it reads —
  HR sees employee, attendance and leave reports; Payroll, the Checker and Admin see pay and statutory reports; Pension
  sees the pension register; a reporting officer sees their own section only, whatever is picked; the User & settings
  manager and employees see none.
- Dashboards (§11): Admin — salary cost (gross + Board's share) and the pension bill of the last approved month,
  retirements in 6 months, the stage of each pay group's bill, approvals waiting, and a panel with headcount by type
  (bars), retirements ahead and the statutory due dates; HR & Accounts — My work, attendance locks open, payroll
  exceptions open on this month's bills, leave waiting, joiners / leavers this month, life certificates overdue;
  Employee — last net pay, leave balance, next increment date, requests waiting (by kind); pensioners keep last
  pension and life certificate.
- API: `GET /api/v1/reports`, `GET /api/v1/reports/{key}`, `GET /api/v1/reports/{key}/export?format=xlsx|pdf`.

**Verified**
- Integration tests (8): the access rules for every login, all 25 reports for one section and type, the salary register
  = pay bill abstract = acquittance = deductions for the same bills (₹74,500 gross, ₹5,550 deductions, ₹68,950 net), a
  ₹350 change explained by its heads, a loan at ₹10,000 after two instalments, NPS with a missing PRAN, the ghost check
  (a salary account taking someone's pension, pay three years after retirement, pay with no attendance), Excel and PDF
  files and their audit rows, the Admin and employee dashboards.
- All 25 reports run on the demo data (largest under 0.3 s); the pay bill abstract, acquittance and deductions agree
  (₹22,12,743 − ₹2,66,473 = ₹19,46,270 for September).
- Browser checks: Admin filters a report by section and downloads Excel and PDF (and finds the download in the audit
  trail); the Admin dashboard; a reporting officer held to their own section; 13 report screens and the Admin
  dashboard on a phone (45 browser checks in all).
- typecheck, lint, 334 unit + integration tests, production build; screens, PDFs and Hindi looked at.

### 2026-10-27 — Module 9: Pension ✅
**Built**
- Pensioner record (PN-01): PPO, kind (superannuation, voluntary, invalid, compulsory, family), basic pension, commuted
  part and date, family pension at the enhanced rate to a date then the normal rate, the payee's date of birth, bank
  (encrypted), the service the pension comes from and the family. Pensioners from the old records and every change to a
  record go to a Checker (only what changed is sent; a new bank number can be revealed by the Checker, audited).
- Monthly pension bill (PN-02 to PN-04, S-61): the "Pensioners" pay group through the same five stages as salaries —
  work out, fix exceptions, Checker, Admin approves and signs with OTP, bank file (to the pensioner's own account, listed
  by PPO), return file, close. Pension = basic (family pension by days at each rate) + additional pension from the 1st of
  the month of turning 80 / 85 / 90 / 95 / 100 + dearness relief at the staff DA rate on both + fixed medical allowance
  (not for CGHS), less the commuted part until it is restored 15 years after commutation (by days; 29 Feb → 1 Mar).
  Months due but not yet paid here (a late case, a family pension that began after the bill, a pension held for a
  certificate) are paid with the next slip, month by month. TDS on the pensioner's own pension is projected like salary
  TDS; recoveries come from pay items. The pay bill (with pension certificates), register, schedules and acquittance
  roll list payees by PPO. The salary run screen is shared; pension bills open under Pension.
- Arrears (PN-05): one job works out every pensioner's due vs drawn for the months already paid and makes one
  supplementary pension bill; the arrears of a pensioner who has since died go to the family pensioner.
- Life certificates (PN-06): November cycle (good until 30 November next year); entered by the Pension clerk (signed at
  the office or a Jeevan Pramaan certificate) or uploaded by the pensioner and checked by the Pension clerk in
  Approvals; SMS a month before and every two weeks while overdue; a pension more than a month overdue is held by the
  bill itself (the exception is resolved by the system with the reason) and the held months are paid with the next
  bill once the certificate is in. Register with due soon / overdue / held / to check.
- New cases (PN-07 to PN-10, S-62): retirement alerts at 12 and 6 months (also in Home "My work"); a no-dues checklist
  per section (dues are recovered from the benefits); the calculator reads the records — qualifying service in
  six-monthly periods (3 months or more is a half-year, at most 66) less leave without pay and dies-non, emoluments (last
  drawn or the 10-month average from approved bills, whichever is more), pension 50% (proportionate from 10 to 20 years,
  ₹9,000 – ₹1,25,000), commutation up to 40% with the dated factor table, retirement / service / death gratuity within
  the ceiling, leave encashment up to 300 days, GPF final payment with this year's interest, family pension enhanced
  and normal with its end date; NPS staff get gratuity and leave encashment. Pension → Checker → Admin; approval issues
  the PPO number and sets the pension up from the day after retirement; the bilingual PPO PDF is stored for physical
  signature; the benefits bill pays gratuity, commuted value and leave encashment less dues. The day after retirement
  the employee leaves the rolls (status, service book entry) and the GPF account is closed.
- Deaths (PN-11): a pensioner's death stops the pension on the day; family pension (PPO "…/F") starts the next day at
  rates from the case or the rules (editable before the Checker); the overpayment is worked out month by month and
  recovered from the family pension (up to a third a month); logins close. A death in service stops pay after the day
  and starts a family pension case (death gratuity, enhanced rate for 10 years); pay drawn after the death is recovered
  from the benefits.
- Pensioners (PN-12): sign in with mobile + OTP (retirees keep their login; family pensioners get their own); Home shows
  the last pension and the certificate date; pension slips (PDF in Hindi or English; SMS and email on credit day); life
  certificate page with how-to and Jeevan Pramaan upload; pension record.
- Rules as tables: pension %, full / minimum years, minimum / maximum pension, family pension %, commutation limit,
  gratuity ceiling, leave encashment days, additional pension slabs and FMA as dated rates; the commutation factor table
  as a dated table changed through an Admin (Rates and rules → Pension tables).
- Demo: five pensioners from the old system — a retiree with a login (DCB09001), an 80-year-old family pensioner with a
  Hindi login (mobile 9810000202), an 86-year-old held for a certificate with a Jeevan Pramaan upload waiting, a retiree
  on CGHS, a family pension at the enhanced rate after a death in service — two closed pension bills, and three
  retirements coming up (Rekha Sharma retires on 30 November).

**Verified**
- Unit tests (12) and integration tests (12) with hand-checked figures: ₹30,000 + 20% + DR 60% + ₹1,000 − ₹12,000 =
  ₹46,600; 40% of ₹75,550 = ₹30,220 × 12 × 8.194 = ₹29,71,472; gratuity capped at ₹25,00,000; restoration and part
  months by days; held months caught up; DR arrears ₹800 a month on ₹20,000; death on the 10th → family pension from the
  11th, overpayment for 21 days recovered; GPF closed once after retirement.
- The demo PPO for Rekha Sharma checked by hand: pension ₹32,050 (50% of ₹64,100), 34 y 9 m 14 d (66 periods),
  commuted value ₹12,60,565 (₹12,820 × 12 × 8.194), gratuity ₹16,92,240 (16½ × ₹1,02,560), leave encashment ₹5,05,963,
  family pension ₹32,050 to 19 Nov 2033 then ₹19,230.
- Browser checks: the pension bill with a held pension, the Jeevan Pramaan approval and the catch-up; a full case
  through Checker and Admin to the PPO and the benefits bill; a family pensioner signing in with mobile OTP in Hindi;
  phone layouts of every pension and pensioner screen (41 browser checks in all).
- typecheck, lint, unit + integration tests, production build; Hindi slips, PPO and screens looked at.

### 2026-10-27 — Module 8: Statutory & tax ✅
**Built**
- Income tax as editable rules (ST-01): slabs, standard deduction, 87A rebate (with marginal relief in the new regime) and
  cess per year and regime, Finance Act 2025 defaults for this year and last; changes go to an Admin (Rates and rules →
  Income tax). Due dates for every filing are an editable table too (Rates and rules → Due dates).
- ST-02 / ST-03 / S-51: under Payslips and Form 16 → My tax, each employee sees the year's tax worked out both ways side by
  side, chooses the regime (new by default), declares old-regime deductions (80C, 80D, 80CCD(1B), home-loan interest, rent
  for HRA, other income) and attaches proofs; a Checker verifies or sends it back. HR & Accounts see everyone's regime,
  status and tax for the year, one person's figures and proofs, and enter salary and TDS carried in from the old system
  or a previous employer (Form 12B) through a Checker.
- ST-04: TDS is no longer a typed pay item. Each month the payroll projects the year — approved bills so far + carried-in
  salary + this month + a full month for each month to come (to March or the month of leaving) — works out the year's
  tax under the chosen regime and spreads what is left over the months left. Declared figures count until December,
  only verified ones from January. The working is on the pay sheet and the payslip.
- GPF (§9, S-50): approved bills post subscriptions and advance instalments to the account (reopening takes them out);
  advances (12–60 instalments, recovered from the next month's pay as a worked-out deduction) and withdrawals within
  the share of the balance in force, Checker then Admin; interest on month-end balances at the notified rate, credited
  for a finished year after an Admin approves; annual statement PDF; GPF pay items held to 6% of Basic and the ₹5 lakh
  yearly cap.
- Monthly files (ST-06, ST-09, S-52): NPS contributions for the CRA, EPF ECR (EPS split, NCP days), ESIC and the Board
  pension fund statement, from the month's approved bills, people with a missing PRAN / UAN / IP number listed; each
  previewed and released by an Admin with its checksum. NPS: the CRA statement upload matches every PRAN and month with
  the bills (matched / amount differs / not credited / not ours).
- ST-05 / ST-06: TDS deducted vs deposited month by month, challans (BSR, serial, date; cess split worked out), and the
  quarterly Form 24Q text file — built only when every rupee of the quarter sits under a challan, with Annexure II in Q4.
- ST-07 / S-53: Form 16 Part B generated from the year's bills (a marked draft until 31 March), Part A PDFs imported by
  the PAN in each TRACES file name, published after an Admin approves; each person gets an SMS and finds both parts under
  Payslips and Form 16.
- ST-08: the statutory calendar (due dates from the rules, each marked done from the record that satisfies it), "My work"
  items and a Home tile for Payroll, and an SMS to Payroll 5 days before each open due date (once per date).
- Settings: the Board's TAN, PAN, responsible person, NPS DDO registration, EPF and ESIC codes; HRA metro rule; the
  professional-tax switch with slabs (off in Delhi; a worked-out deduction when switched on).
- Seed: this year's declarations (one waiting for a Checker), salary and TDS of April–July carried in from the old system,
  GPF balances brought forward with a running advance, and the history months filed — TDS deposited, files released.

**Verified**
- 302 unit + integration tests (35 new: both regimes, rebate and marginal relief, HRA exemption, caps, the Board's NPS in
  salary and 80CCD(2), monthly spread, GPF interest on month-end balances with a withdrawal and a rate change, CRA / ECR /
  24Q layouts, the calendar across the year end; on a real database: declaration → Checker → TDS from verified figures,
  later months counting what was deducted, GPF posting, the 6% minimum and the yearly cap, an advance through Checker and
  Admin recovered and undone on reopen, interest credited once for a finished year only, challans covering a quarter
  before its 24Q and locked once released, all four monthly files, CRA matching, Form 16 Part B / Part A / publish,
  reminders sent once, a slab change through an Admin), typecheck, lint, build.
- 36 Playwright checks (6 new: declaration with a proof verified by a Checker, GPF advance through Checker and Admin with
  the statement PDF, revised NPS file released by an Admin and a CRA statement checked, the finished quarter's 24Q,
  Form 16 Part B; every statutory screen and My tax / My GPF–NPS fit a phone).
- Tax checked by hand (old regime ₹19,88,680 taxable → ₹4,25,468; new regime ₹19,41,960 → ₹1,95,928; marginal relief at
  ₹12,10,000 → ₹10,400); GPF interest checked by hand (₹33.6 lakh at 7.1% → about ₹19,900 a month); Form 16 Part B, the
  GPF statement and the 24Q file read through; screens checked in Hindi and on a phone.

**Fixed while verifying**
- The Board's NPS share was deducted under 80CCD(2) without first being counted in salary (s. 17(1)(viii)), which
  under-taxed NPS staff.
- The calendar showed ESIC as overdue for months in which nobody was within the ESIC ceiling; a filing is now "nothing
  due" when its deduction was not made that month.
- File-type names contained a dot, which the text lookup read as nesting; the TDS table no longer lists the months before
  the first pay bill made here.

### 2026-10-27 — Module 7: Pay changes, arrears, loans & salary slips ✅
**Built**
- Pay history (level, cell and post from a date): the payroll reads what is in force on the 1st; a change dated ahead
  waits and reaches the employee record on its day. Employee master edits of pay are corrections through the Checker.
- S-41 Increments (PR-06): the 1 January / 1 July due list with six months in the level, the next cell and the new Basic,
  leave without pay flagged, top of the level shown; one batch to a Checker; on approval the pay history and a service
  book entry for each person. Pay fixation (PR-07): promotion or MACP, the option the employee chose, the rule and every
  figure on screen; Checker then Admin; the post changes on promotion and the increment month follows the option.
- S-42 Arrears (PR-08): due vs drawn month by month — rates, matrix and pay history as they stand now, on the days the
  month actually paid; only system-worked heads compared; arrears already paid count as drawn. Supplementary bills are
  payrolls of their own (same five stages, OTP, bank file, return file, close): arrears, pay withheld at a pre-check and
  since put right, joiners the regular bill missed.
- S-43 Loans (PR-09): sanction with the order (Checker, then Admin), live schedule, simple interest on the reducing
  balance after the principal, recovery through each payroll recorded when it is approved and taken back if reopened;
  the loan closes at zero. Loan instalments are no longer typed as pay items.
- S-44 Payslips (SL-01–05): PDF in Hindi or English with logo, ID, post, level and cell, bank last four, masked PAN,
  earnings and deductions, net in figures and words, leave balance, NPS to date / GPF this year, month-wise arrears on a
  supplementary slip; SMS link and email with the PDF on credit day (after the bank file is released); employees see every
  past month under My payslips (two taps on a phone); HR & Accounts download a bill or a section as one PDF and resend.
- Email connector (Board SMTP from System settings, credentials from the environment; logged only until set up).
- Seed: last 1 January and 1 July increments given (pay history + service book), a festival advance and a computer advance
  recovered through the two closed months.

**Verified**
- 267 unit + integration tests (16 new: increment dates and the six-month rule, both fixation options, loan schedules with
  interest and missed months; on a real database: increment through a Checker with service book, the late increment as
  arrears and its supplementary bill (and nothing left once paid), withheld pay paid once, promotion through Checker and
  Admin with a future step waiting, a loan recovered, undone on reopen and closed at zero, own payslips only, notices
  sent once), typecheck, lint, build.
- 30 Playwright checks (5 new: increment list, promotion fixation, back-dated DA → arrears bill, loan sanction, payslip
  downloads; every new screen fits a phone).
- Payslip PDF checked in Hindi and English; arrears figures checked by hand (DA 60% → 64% on ₹58,600 = ₹2,344 a month).

**Fixed while verifying**
- Form fields meant to span two or three columns (rates, pay heads, pay items, loans, fixation, arrears) put the span on
  the input instead of its wrapper, so they stayed one column wide.
- A pay correction made through the employee master now goes into the pay history, so an older history row can never
  override it.
- The demo's waiting leave applications now start on a Monday, so Pooja's EL reads "5 days" whichever day the demo is
  loaded (it read 7 when loaded on a Tuesday night).

### 2026-10-26 — Security: Next.js and mail library
- Next.js 16.3.8 → 16.4.2 (with eslint-config-next): 16.0.0–16.4.0 are covered by published critical advisories
  (unauthenticated remote code execution in the image optimiser and `use cache`, a Server Actions denial of service).
- nodemailer 10.2.1 added for payslip email (SL-04): every earlier line has open advisories (recipient-domain confusion,
  SMTP command injection).
- Verified: 251 unit + integration tests, 25 browser checks, typecheck, lint and build on the new versions.
- Left for the Module 10 hardening pass: advisories in the Prisma CLI's own dependencies (mysql2, deepmerge-ts — build
  tools, not in the running app) and exceljs's bundled uuid (moderate).

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
- Module 10: the migration console with the §15 checks and the parallel run, data export, hardening, accessibility
  pass and the deployment guide.
- Carried items: employee screens still show Basic from the built-in 7th CPC table (payroll and fixation read the dated
  matrix) — one switch in Module 10 hardening; dev-tool audit items (Module 10); mid-year cut-over also needs the old
  system's GPF subscriptions for 80C (the carry-in holds salary and TDS) and its 24Q deductee rows for the cut-over
  quarter, and bulk loading of pensioners (migration console, Module 10).

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
| D-29 | Dependencies with published security fixes are upgraded as soon as they are found, even mid-module, as their own verified commit | A payroll system holding bank and Aadhaar data cannot wait for a release cycle |
| D-30 | Pay level, cell and post are kept as dated pay history; a month uses the row in force on its 1st; future rows reach the employee record on their date | Increments approved in December for 1 January, option-B fixations and arrears all need "pay as of a date" |
| D-31 | Arrears compare only heads the system works out (Basic, NPA, DA, HRA, TA, DA on TA, post allowances, NPS, EPF, ESIC and employer shares); standing amounts, GPF subscription and group insurance are left alone; arrears already paid count as drawn | A back-dated order changes formulas, not the amounts a person chose or a fixed premium |
| D-32 | Supplementary bills are payrolls of their own (numbered per pay group and month) and go through the same five stages, OTP and bank file | One control path for every rupee paid |
| D-33 | Loans: principal first in equal instalments, then simple interest on the reducing balance in instalments of the same size; a recovery is recorded when its payroll is approved and removed if it is reopened | Central government advance rules; the loan account always matches what the bills paid |
| D-34 | Payslips become visible and notices go out on credit day — when the salary bank file is released — after the release is saved; sending is safe to repeat | The slip is never shown for pay that may still be reopened (PR-13) |
| D-35 | Increments and fixation are prepared by HR & Accounts users who hold Payroll (or HR with payroll access); fixation goes Checker → Admin like other promotion entries | Keeps §13/§14 menus as they are; PR-07 promotion is an Approver event in the service book |
| D-36 | TDS is worked out by the payroll every month from the year's projection (paid so far + carried in + this month + a full month for each month to come), never typed; declared deductions count until December, verified ones from January | ST-04 "projected on full-year income, adjusted each month and in the final quarter" with nothing to keep in step by hand |
| D-37 | Salary and TDS of the year paid outside the system (old system before cut-over, previous employer) are one Checker-checked record per person and year | A mid-year go-live would otherwise under-project everyone's tax; the same record serves Form 12B joiners |
| D-38 | GPF interest = Σ month-end balance × rate ÷ 1200 at the rate in force each month (recoveries count from their month; money taken out stops earning from its month), rounded once a year; credited for a finished year only, after an Admin approves | GPF Rules r. 11 in its usual monthly-product form; interest is a once-a-year posting the Board signs off |
| D-39 | A monthly filing is "done" when its file is released by an Admin (or its challans cover the month's TDS); "nothing due" when no one had that deduction that month | The calendar is driven by records, not ticks, so it cannot say done when nothing went out |
| D-40 | Form 16 Part B can be generated any time as a marked draft, but publishing to employees opens only after 31 March and needs an Admin | Lets HR check figures early without an employee ever seeing a mid-year "Form 16" |
| D-41 | Every pension hangs on the employee record of the service that earned it (retirees and the deceased stay as Retired / Deceased employees); a family pensioner has a login of their own linked to the pension; one running pension per service at a time | Service, pay history and family are already on that record; family pensioners have no service of their own |
| D-42 | Pension bills are payrolls of the pay group "Pensioners" — same five stages, OTP, bank file and prints — under the §14 Pension row (Pension prepares, Checker checks, Admin approves and signs); retirement benefits and pension arrears are supplementary pension bills | PN-02 "same five-stage flow and maker-checker as staff payroll" with one control path for every rupee |
| D-43 | A month due but not yet paid here (late case, family pension begun after the bill, pension held for a certificate) is paid with the next regular slip at the rates in force; months before the first pension bill in the system belong to the old system | Nobody waits for a separate bill; nothing is paid twice |
| D-44 | Life certificates run on one November cycle: given October–December → good until 30 November next year, otherwise until 30 November that year; the pension is held from the 1st of the month after the month following, by the system with the reason | PN-06 "held after one month overdue" made exact; no clerk has to remember to hold |
| D-45 | A family pension beginning mid-month after a pensioner's death starts on the next bill (that month's slip stays the deceased's, to the death date); pension paid for days after a death is kept per month and head, so a later DR arrears bill never recovers it twice | One slip per service per bill; arrears and recoveries agree |
| D-46 | After the death of a pensioner brought over from the old records, family pension is suggested from emoluments of twice the basic pension (full pension is half of them); the Pension clerk can change it before the Checker approves | The old records rarely hold last pay; the order on paper decides |
| D-47 | The GPF account is closed when the person has left the rolls and the case is approved: this year's interest to the month of leaving is credited and the final payment taken out; the 31 March credit skips interest already credited | The ledger ends at zero and the annual credit stays correct for everyone else |
| D-48 | The commutation factor table is a dated rule table changed through an Admin; every other pension figure is a dated rate | PRD §10: "all formulas are editable tables with central-rule defaults" |
| D-49 | A report needs the Reports right and the view right of the function it reads; the narrower scope wins (a section-limited right shows the login's own section only) | §14 has a Reports row and a row per function; a report must not show pay to someone who cannot open pay screens |
| D-50 | Payroll and statutory reports read approved bills only (approved, paid, closed), regular and supplementary together; pay withheld is left out until a supplementary bill pays it | Reports show what was paid, and they add up to the signed bills |
| D-51 | A report download (Excel or PDF) is logged as a print in the audit trail with its filters and row count; viewing on screen is not | PRD §11: "every create, edit, approve and print"; viewing is already gated by the session |
| D-52 | The ghost check also compares staff bank accounts with running pensions and pensions with each other, because the database already refuses the same Aadhaar, PAN or bank account for two current staff | The PRD control would otherwise always be empty; the real leaks are pensions paid into other people's accounts |
| D-08 | Delhi Cantt logo could not be downloaded from inside the build environment (network policy). A placeholder emblem sits at `public/brand/logo.svg`; drop the real logo at the same path | — |

## Known gaps / risks
- Exact bank bulk-file, CRA contribution, e-Chhawani and Form 24Q layouts, the pay bill / register / schedule formats (CBAR 2020) and the e-Chhawani account heads must be confirmed against real samples before go-live (PRD §18 open questions). They are built as switchable templates.
- Leave, pension and tax defaults follow central rules and are marked "to confirm for DCB" in the rules tables; pension
  rules (CCS (Pension) Rules 2021, the 2008 commutation table) to confirm against the Cantonment Board Employees Service
  Rules 2021 (PRD §10); the PPO layout to match DCB's printed PPO (PRD §18).
- One family pension runs at a time on a service (two eligible widows sharing is not handled); Jeevan Pramaan is an
  upload of the certificate, not a live API pull, in Release 1; disability / extraordinary pension beyond invalid
  pension is not modelled.
- Form 24Q (including Annexure II), the CRA contribution file, ECR and the ESIC file follow the published layouts but must
  pass the Protean FVU / one real portal upload before the first filing; the 24Q of the cut-over quarter covers only the
  months paid through this system.
- Surcharge (income above ₹50 lakh) is not applied — no Board salary reaches it; relief u/s 89 is shown as nil.
- Pay fixation options (FR 22(I)(a)(1)) and the FR 26 postponement of increments for leave without pay (flagged, not applied automatically) to be confirmed with DCB Accounts; stagnation increments beyond the last cell are not granted automatically.
