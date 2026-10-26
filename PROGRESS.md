# Progress & change log

This file records **what has changed, what was verified, and what is still pending**.
The module checklist with PRD IDs is in [PLAN.md](./PLAN.md).

## Status at a glance

| # | Module | Status |
|---|--------|--------|
| 1 | Foundation & platform | 🟢 Done & verified (2 items carried to later modules, see PLAN.md) |
| 2 | Employee master | 🟢 Done & verified |
| 3 | Recruitment & onboarding | 🟡 Next |
| 4 | Attendance & holidays | ⚪ Pending |
| 5 | Leave | ⚪ Pending |
| 6 | Rates & rules + monthly payroll | ⚪ Pending |
| 7 | Pay changes, arrears, loans & salary slips | ⚪ Pending |
| 8 | Statutory & tax | ⚪ Pending |
| 9 | Pension | ⚪ Pending |
| 10 | Reports, dashboards, migration & go-live | ⚪ Pending |

🟢 Done & verified · 🟡 In progress · ⚪ Pending

---

## Change log (newest first)

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
- Module 3: Recruitment & onboarding (RO-01…09, S-20…S-22): vacancy against vacant sanctioned post, applicants,
  selection list, appointment letter (Hindi + English), joining checklist, "Complete joining", PRAN / EPF-ESIC files.
- Carried items: pensioner view of the Employee login (Module 9), email sending (Module 7), outgoing-file approval flow
  (first used in Module 3), formal accessibility pass (Module 10).

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
| D-08 | Delhi Cantt logo could not be downloaded from inside the build environment (network policy). A placeholder emblem sits at `public/brand/logo.svg`; drop the real logo at the same path | — |

## Known gaps / risks
- Exact bank bulk-file, CRA contribution, e-Chhawani and Form 24Q layouts must be confirmed against real samples before go-live (PRD §18 open questions). They are built as switchable templates.
- Leave, pension and tax defaults follow central rules and are marked "to confirm for DCB" in the rules tables.
