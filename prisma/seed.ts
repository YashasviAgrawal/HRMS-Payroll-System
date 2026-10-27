/**
 * Seed data.
 *  - Always: the Board, its sections and posts, and a first User & settings manager (so someone can log in).
 *  - In the development, test and training copies (APP_ENV), unless SEED_DEMO=0: demo employees and one
 *    login for every role, for training and testing. Demo password for every login: Dcb@2026.
 *    Never in production, whatever NODE_ENV or SEED_DEMO say.
 *
 * Safe to run more than once (upserts by natural keys).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { EmployeeType, LoginType, Permission } from "../src/generated/prisma/enums";
import { sealWith } from "../src/lib/crypto-core";
import { addDays, addYears, fromISODate, retirementDate, shiftMonth, todayIST } from "../src/lib/dates";
import { hashPassword } from "../src/lib/password";
import { verhoeffCheckDigit } from "../src/lib/validators";
import { seedAttendance } from "./seed-attendance";
import { seedLeaveTypes } from "./seed-leave";
import { seedPayrollDemo, seedPayrollRules } from "./seed-payroll";
import { seedPensionDemo, seedPensionRules } from "./seed-pension";
import { seedStatutoryRules } from "./seed-statutory";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DEMO = (process.env.APP_ENV ?? "development") !== "production" && process.env.SEED_DEMO !== "0";
const DEMO_PASSWORD = "Dcb@2026";
const ENC_KEY = Buffer.from(process.env.DATA_ENCRYPTION_KEY ?? "", "base64");
const IDX_KEY = Buffer.from(process.env.BLIND_INDEX_KEY ?? "", "base64");

/** Demo identity numbers that pass the format checks (Aadhaar has a valid Verhoeff digit). Not real people. */
function demoIds(i: number, last: string) {
  const base = `${2 + (i % 7)}${String(4100000000 + i * 7919).padStart(10, "0")}`;
  const aadhaar = base + verhoeffCheckDigit(base);
  const pan = `AB${String.fromCharCode(67 + (i % 20))}P${last[0].toUpperCase()}${String(1000 + i * 37).slice(-4)}${String.fromCharCode(65 + (i % 26))}`;
  const bank = `3${String(1000000000 + i * 104729).padStart(10, "0")}`;
  return { aadhaar, pan, bank };
}

const SECTIONS: [code: string, name: string, nameHi: string][] = [
  ["ADM", "Administration", "प्रशासन"],
  ["ACC", "Accounts", "लेखा"],
  ["REV", "Revenue and Tax", "राजस्व एवं कर"],
  ["HLT", "Health and Sanitation", "स्वास्थ्य एवं स्वच्छता"],
  ["ENG", "Engineering", "अभियांत्रिकी"],
  ["WTR", "Water Supply", "जल आपूर्ति"],
  ["ELE", "Electrical", "विद्युत"],
  ["EDU", "Education", "शिक्षा"],
  ["HSP", "Cantonment General Hospital", "छावनी सामान्य अस्पताल"],
  ["EST", "Estate and Land", "संपदा एवं भूमि"],
  ["HRT", "Horticulture", "उद्यान"],
  ["ITC", "IT Cell", "आईटी सेल"],
];

const POSTS: [code: string, name: string, nameHi: string, level: string, group: string, retirementAge?: number][] = [
  ["CEO", "Chief Executive Officer", "मुख्य कार्यपालक अधिकारी", "12", "A"],
  ["AO", "Administrative Officer", "प्रशासनिक अधिकारी", "10", "A"],
  ["MO", "Medical Officer", "चिकित्सा अधिकारी", "10", "A", 62],
  ["AE", "Assistant Engineer", "सहायक अभियंता", "10", "A"],
  ["OS", "Office Superintendent", "कार्यालय अधीक्षक", "7", "B"],
  ["ACCT", "Accountant", "लेखाकार", "6", "B"],
  ["JE", "Junior Engineer", "कनिष्ठ अभियंता", "6", "B"],
  ["SI", "Sanitary Inspector", "स्वच्छता निरीक्षक", "6", "B"],
  ["SN", "Staff Nurse", "स्टाफ़ नर्स", "7", "B"],
  ["PRT", "Primary Teacher", "प्राथमिक शिक्षक", "6", "B"],
  ["HC", "Head Clerk", "प्रधान लिपिक", "5", "C"],
  ["UDC", "Upper Division Clerk", "उच्च श्रेणी लिपिक", "4", "C"],
  ["LDC", "Lower Division Clerk", "निम्न श्रेणी लिपिक", "2", "C"],
  ["DRV", "Driver", "चालक", "2", "C"],
  ["ELC", "Electrician", "विद्युतकार", "2", "C"],
  ["PMP", "Pump Operator", "पंप ऑपरेटर", "2", "C"],
  ["MTS", "Multi Tasking Staff", "मल्टी टास्किंग स्टाफ़", "1", "C"],
  ["SK", "Safai Karamchari", "सफ़ाई कर्मचारी", "1", "C"],
  ["MALI", "Mali", "माली", "1", "C"],
];

type DemoEmployee = {
  code: string;
  first: string;
  last: string;
  hi: string;
  gender: "M" | "F";
  dob: string;
  doj: string;
  section: string;
  post: string;
  type: EmployeeType;
  cell?: number;
  mobile: string;
};

// A realistic spread: OPS (joined before 2004), NPS, contract, daily wage, re-employed, deputation.
const EMPLOYEES: DemoEmployee[] = [
  { code: "DCB10001", first: "Anil", last: "Sharma", hi: "अनिल शर्मा", gender: "M", dob: "1972-03-14", doj: "2022-06-01", section: "ADM", post: "CEO", type: "DEPUTATION", cell: 9, mobile: "9810000001" },
  { code: "DCB10002", first: "Sunita", last: "Verma", hi: "सुनीता वर्मा", gender: "F", dob: "1970-08-22", doj: "1996-04-15", section: "ADM", post: "AO", type: "PERMANENT_OPS", cell: 14, mobile: "9810000002" },
  { code: "DCB10003", first: "Priya", last: "Singh", hi: "प्रिया सिंह", gender: "F", dob: "1985-11-05", doj: "2010-07-12", section: "ADM", post: "HC", type: "PERMANENT_NPS", cell: 8, mobile: "9810000003" },
  { code: "DCB10004", first: "Mohit", last: "Gupta", hi: "मोहित गुप्ता", gender: "M", dob: "1988-01-19", doj: "2012-03-01", section: "ACC", post: "ACCT", type: "PERMANENT_NPS", cell: 7, mobile: "9810000004" },
  { code: "DCB10005", first: "Kavita", last: "Rani", hi: "कविता रानी", gender: "F", dob: "1979-06-30", doj: "2003-09-01", section: "ACC", post: "UDC", type: "PERMANENT_OPS", cell: 12, mobile: "9810000005" },
  { code: "DCB10006", first: "Deepak", last: "Yadav", hi: "दीपक यादव", gender: "M", dob: "1983-04-01", doj: "2008-11-20", section: "ACC", post: "OS", type: "PERMANENT_NPS", cell: 6, mobile: "9810000006" },
  { code: "DCB10007", first: "Neha", last: "Arora", hi: "नेहा अरोड़ा", gender: "F", dob: "1990-12-12", doj: "2015-02-02", section: "ADM", post: "UDC", type: "PERMANENT_NPS", cell: 5, mobile: "9810000007" },
  { code: "DCB10008", first: "Rajesh", last: "Kumar", hi: "राजेश कुमार", gender: "M", dob: "1968-01-01", doj: "1991-08-01", section: "HLT", post: "SI", type: "PERMANENT_OPS", cell: 18, mobile: "9810000008" },
  { code: "DCB10009", first: "Ramesh", last: "Chand", hi: "रमेश चंद", gender: "M", dob: "1967-02-10", doj: "1990-05-14", section: "HLT", post: "SK", type: "PERMANENT_OPS", cell: 20, mobile: "9810000009" },
  { code: "DCB10010", first: "Suresh", last: "Pal", hi: "सुरेश पाल", gender: "M", dob: "1992-09-09", doj: "2018-01-08", section: "HLT", post: "SK", type: "PERMANENT_NPS", cell: 6, mobile: "9810000010" },
  { code: "DCB10011", first: "Meena", last: "Devi", hi: "मीना देवी", gender: "F", dob: "1987-05-25", doj: "2014-06-16", section: "HLT", post: "SK", type: "PERMANENT_NPS", cell: 9, mobile: "9810000011" },
  { code: "DCB10012", first: "Vikas", last: "Malhotra", hi: "विकास मल्होत्रा", gender: "M", dob: "1984-07-17", doj: "2009-10-05", section: "ENG", post: "JE", type: "PERMANENT_NPS", cell: 10, mobile: "9810000012" },
  { code: "DCB10013", first: "Arun", last: "Joshi", hi: "अरुण जोशी", gender: "M", dob: "1975-10-03", doj: "2001-12-10", section: "ENG", post: "AE", type: "PERMANENT_OPS", cell: 13, mobile: "9810000013" },
  { code: "DCB10014", first: "Pooja", last: "Bhatia", hi: "पूजा भाटिया", gender: "F", dob: "1993-03-28", doj: "2024-11-18", section: "EDU", post: "PRT", type: "PERMANENT_NPS", cell: 3, mobile: "9810000014" },
  { code: "DCB10015", first: "Sanjay", last: "Rawat", hi: "संजय रावत", gender: "M", dob: "1981-08-08", doj: "2006-04-03", section: "WTR", post: "PMP", type: "PERMANENT_NPS", cell: 12, mobile: "9810000015" },
  { code: "DCB10016", first: "Geeta", last: "Negi", hi: "गीता नेगी", gender: "F", dob: "1980-02-14", doj: "2004-03-15", section: "HSP", post: "SN", type: "PERMANENT_NPS", cell: 13, mobile: "9810000016" },
  { code: "DCB10017", first: "Dr. Alok", last: "Mishra", hi: "डॉ. आलोक मिश्रा", gender: "M", dob: "1976-11-30", doj: "2005-08-22", section: "HSP", post: "MO", type: "PERMANENT_NPS", cell: 15, mobile: "9810000017" },
  { code: "DCB10018", first: "Harish", last: "Thakur", hi: "हरीश ठाकुर", gender: "M", dob: "1966-12-31", doj: "1989-01-09", section: "ELE", post: "ELC", type: "PERMANENT_OPS", cell: 22, mobile: "9810000018" },
  { code: "DCB10019", first: "Manoj", last: "Tiwari", hi: "मनोज तिवारी", gender: "M", dob: "1989-06-06", doj: "2013-09-09", section: "REV", post: "LDC", type: "PERMANENT_NPS", cell: 9, mobile: "9810000019" },
  { code: "DCB10020", first: "Shalini", last: "Kapoor", hi: "शालिनी कपूर", gender: "F", dob: "1991-01-23", doj: "2016-11-14", section: "EST", post: "LDC", type: "PERMANENT_NPS", cell: 7, mobile: "9810000020" },
  { code: "DCB10021", first: "Ravi", last: "Prakash", hi: "रवि प्रकाश", gender: "M", dob: "1995-04-04", doj: "2023-04-03", section: "HRT", post: "MALI", type: "CONTRACT", mobile: "9810000021" },
  { code: "DCB10022", first: "Babita", last: "Kumari", hi: "बबिता कुमारी", gender: "F", dob: "1997-07-07", doj: "2024-01-15", section: "HLT", post: "SK", type: "DAILY_WAGE", mobile: "9810000022" },
  { code: "DCB10023", first: "Om", last: "Prakash", hi: "ओम प्रकाश", gender: "M", dob: "1963-09-15", doj: "2024-10-01", section: "ACC", post: "ACCT", type: "REEMPLOYED", mobile: "9810000023" },
  { code: "DCB10024", first: "Ashok", last: "Saini", hi: "अशोक सैनी", gender: "M", dob: "1986-10-10", doj: "2011-05-02", section: "ADM", post: "DRV", type: "PERMANENT_NPS", cell: 11, mobile: "9810000024" },
  { code: "DCB10025", first: "Rekha", last: "Sharma", hi: "रेखा शर्मा", gender: "F", dob: "1966-11-20", doj: "1992-02-17", section: "EDU", post: "PRT", type: "PERMANENT_OPS", cell: 21, mobile: "9810000025" },
];

type DemoUser = { loginType: LoginType; loginId: string; name: string; nameHi: string; mobile: string; employee?: string; permissions: Permission[] };

const USERS: DemoUser[] = [
  // Admin login (CEO, AO/DDO, IT cell)
  { loginType: "ADMIN", loginId: "DCB10001", name: "Anil Sharma", nameHi: "अनिल शर्मा", mobile: "9810000001", employee: "DCB10001", permissions: ["APPROVER"] },
  { loginType: "ADMIN", loginId: "DCB10002", name: "Sunita Verma", nameHi: "सुनीता वर्मा", mobile: "9810000002", employee: "DCB10002", permissions: ["APPROVER", "PAY_BILL_SIGNER"] },
  { loginType: "ADMIN", loginId: "IT01", name: "Rahul Mehta (IT Cell)", nameHi: "राहुल मेहता (आईटी सेल)", mobile: "9810000101", permissions: ["USER_SETTINGS_MANAGER"] },
  // HR & Accounts Manager login
  { loginType: "HR_ACCOUNTS", loginId: "DCB10003", name: "Priya Singh", nameHi: "प्रिया सिंह", mobile: "9810000003", employee: "DCB10003", permissions: ["HR"] },
  { loginType: "HR_ACCOUNTS", loginId: "DCB10004", name: "Mohit Gupta", nameHi: "मोहित गुप्ता", mobile: "9810000004", employee: "DCB10004", permissions: ["PAYROLL"] },
  { loginType: "HR_ACCOUNTS", loginId: "DCB10005", name: "Kavita Rani", nameHi: "कविता रानी", mobile: "9810000005", employee: "DCB10005", permissions: ["PENSION"] },
  { loginType: "HR_ACCOUNTS", loginId: "DCB10006", name: "Deepak Yadav", nameHi: "दीपक यादव", mobile: "9810000006", employee: "DCB10006", permissions: ["CHECKER"] },
  { loginType: "HR_ACCOUNTS", loginId: "DCB10007", name: "Neha Arora", nameHi: "नेहा अरोड़ा", mobile: "9810000007", employee: "DCB10007", permissions: ["HR", "CHECKER"] },
  // Employee login — a section head (reporting officer) and ordinary staff
  { loginType: "EMPLOYEE", loginId: "DCB10008", name: "Rajesh Kumar", nameHi: "राजेश कुमार", mobile: "9810000008", employee: "DCB10008", permissions: ["REPORTING_OFFICER"] },
  { loginType: "EMPLOYEE", loginId: "DCB10010", name: "Suresh Pal", nameHi: "सुरेश पाल", mobile: "9810000010", employee: "DCB10010", permissions: [] },
  { loginType: "EMPLOYEE", loginId: "DCB10014", name: "Pooja Bhatia", nameHi: "पूजा भाटिया", mobile: "9810000014", employee: "DCB10014", permissions: [] },
  { loginType: "EMPLOYEE", loginId: "DCB10003", name: "Priya Singh", nameHi: "प्रिया सिंह", mobile: "9810000003", employee: "DCB10003", permissions: [] },
  { loginType: "EMPLOYEE", loginId: "DCB10004", name: "Mohit Gupta", nameHi: "मोहित गुप्ता", mobile: "9810000004", employee: "DCB10004", permissions: [] },
];

async function main() {
  const board = await db.board.upsert({
    where: { code: process.env.BOARD_CODE ?? "DCB" },
    create: { code: process.env.BOARD_CODE ?? "DCB", name: "Delhi Cantonment Board", nameHi: "दिल्ली छावनी परिषद", address: "Sadar Bazar, Delhi Cantt – 110010" },
    update: {},
  });

  const sectionIds = new Map<string, string>();
  for (const [code, name, nameHi] of SECTIONS) {
    const s = await db.section.upsert({ where: { boardId_code: { boardId: board.id, code } }, create: { boardId: board.id, code, name, nameHi }, update: { name, nameHi } });
    sectionIds.set(code, s.id);
  }
  const postIds = new Map<string, { id: string; level: string; retirementAge: number }>();
  for (const [code, name, nameHi, payLevel, group, retirementAge = 60] of POSTS) {
    const p = await db.post.upsert({
      where: { boardId_code: { boardId: board.id, code } },
      create: { boardId: board.id, code, name, nameHi, payLevel, group, retirementAge },
      update: { name, nameHi, payLevel, group, retirementAge },
    });
    postIds.set(code, { id: p.id, level: payLevel, retirementAge });
  }

  // The leave rules table (PRD §7 defaults) belongs to every installation, demo or not.
  await seedLeaveTypes(db, board.id);
  // So are the pay matrix, the dated rates and the pay heads (PRD §8).
  await seedPayrollRules(db, board.id);
  await seedStatutoryRules(db, board.id);
  await seedPensionRules(db, board.id);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // The first User & settings manager always exists so the Board can create everyone else.
  const bootstrapMobile = process.env.BOOTSTRAP_ADMIN_MOBILE ?? "9810000101";
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!DEMO) {
    if (!bootstrapPassword) throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD (and BOOTSTRAP_ADMIN_MOBILE) to seed production.");
    await db.user.upsert({
      where: { boardId_loginType_loginId: { boardId: board.id, loginType: "ADMIN", loginId: "IT01" } },
      create: {
        boardId: board.id,
        loginType: "ADMIN",
        loginId: "IT01",
        displayName: "IT Cell",
        mobile: bootstrapMobile,
        passwordHash: await hashPassword(bootstrapPassword),
        mustChangePassword: true,
        permissions: ["USER_SETTINGS_MANAGER"],
      },
      update: {},
    });
    console.log("Seeded Board, sections, posts and the IT01 settings manager.");
    return;
  }

  const employeeIds = new Map<string, string>();
  for (const [i, e] of EMPLOYEES.entries()) {
    const post = postIds.get(e.post)!;
    const ids = demoIds(i + 1, e.last);
    const pan = sealWith(ENC_KEY, IDX_KEY, "pan", ids.pan);
    const aadhaar = sealWith(ENC_KEY, IDX_KEY, "aadhaar", ids.aadhaar);
    const bank = sealWith(ENC_KEY, IDX_KEY, "bank", ids.bank);
    const matrix = ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"].includes(e.type);
    const address = { line1: `${100 + i} Sadar Bazar`, line2: "Delhi Cantonment", city: "New Delhi", district: "South West Delhi", state: "Delhi", pincode: "110010" };
    const data = {
      boardId: board.id,
      employeeCode: e.code,
      type: e.type,
      firstName: e.first,
      lastName: e.last,
      nameHi: e.hi,
      gender: e.gender,
      dateOfBirth: fromISODate(e.dob),
      dateOfJoining: fromISODate(e.doj),
      dateOfRetirement: matrix ? fromISODate(retirementDate(e.dob, post.retirementAge)) : null,
      sectionId: sectionIds.get(e.section)!,
      postId: post.id,
      payLevel: e.cell ? post.level : null,
      payCell: e.cell ?? null,
      mobile: e.mobile,
      email: `${e.first.toLowerCase().replace(/[^a-z]/g, "")}.${e.last.toLowerCase()}@dcb.example`,
      fatherOrSpouseName: e.gender === "F" ? "Shri Ram Prasad" : "Shri Mohan Lal",
      category: ["GEN", "OBC", "SC", "GEN", "ST"][i % 5],
      maritalStatus: "MARRIED",
      presentAddress: address,
      permanentAddress: address,
      panEnc: pan.enc,
      panHash: pan.hash,
      panLast4: pan.last4,
      aadhaarEnc: aadhaar.enc,
      aadhaarHash: aadhaar.hash,
      aadhaarLast4: aadhaar.last4,
      bankAccountEnc: bank.enc,
      bankAccountHash: bank.hash,
      bankAccountLast4: bank.last4,
      ifsc: "SBIN0001234",
      bankName: "State Bank of India",
      bankBranch: "Delhi Cantt",
      pran: e.type === "PERMANENT_NPS" ? String(110000000000 + i * 1013) : null,
      gpfNumber: e.type === "PERMANENT_OPS" ? `DCB/GPF/${1000 + i}` : null,
      uan: ["CONTRACT", "DAILY_WAGE"].includes(e.type) ? String(100900000000 + i * 211) : null,
      esicNumber: ["CONTRACT", "DAILY_WAGE"].includes(e.type) ? String(2010000000 + i * 97) : null,
      agencyName: e.type === "CONTRACT" ? "Shiv Shakti Manpower Services" : null,
      wageRate: e.type === "CONTRACT" ? 21917 : e.type === "DAILY_WAGE" ? 843 : e.type === "REEMPLOYED" ? 45000 : null,
      wageBasis: e.type === "DAILY_WAGE" ? "DAILY" : ["CONTRACT", "REEMPLOYED"].includes(e.type) ? "MONTHLY" : null,
      contractStart: ["CONTRACT", "REEMPLOYED"].includes(e.type) ? fromISODate(e.doj) : null,
      // Contracts run to the end of the financial year and are renewed each April.
      contractEnd: ["CONTRACT", "REEMPLOYED"].includes(e.type) ? fromISODate("2027-03-31") : null,
      biometricId: e.code.slice(3),
      probationEndDate: ["PERMANENT_OPS", "PERMANENT_NPS"].includes(e.type) && e.doj > "2020-01-01" ? fromISODate(addDays(addYears(e.doj, 2), -1)) : null,
    };
    const row = await db.employee.upsert({ where: { boardId_employeeCode: { boardId: board.id, employeeCode: e.code } }, create: data, update: data });
    employeeIds.set(e.code, row.id);

    // Family, nominees and an appointment entry in the service book — only once.
    if ((await db.familyMember.count({ where: { employeeId: row.id } })) === 0) {
      const spouse = await db.familyMember.create({
        data: { employeeId: row.id, name: e.gender === "F" ? `Shri ${["Rakesh", "Sunil", "Vijay"][i % 3]} ${e.last}` : `Smt. ${["Anita", "Sunita", "Rekha"][i % 3]} ${e.last}`, relation: "SPOUSE", gender: e.gender === "F" ? "M" : "F", dateOfBirth: fromISODate(addYears(e.dob, 2)), isDependent: true },
      });
      const child = await db.familyMember.create({
        data: { employeeId: row.id, name: `${["Aarav", "Diya", "Kabir", "Ananya"][i % 4]} ${e.last}`, relation: i % 2 ? "DAUGHTER" : "SON", gender: i % 2 ? "F" : "M", dateOfBirth: fromISODate(addYears(e.doj, 3)), isDependent: true },
      });
      const scheme = e.type === "PERMANENT_OPS" ? "GPF" : e.type === "PERMANENT_NPS" ? "NPS" : null;
      if (scheme) {
        await db.nominee.create({ data: { employeeId: row.id, scheme, familyMemberId: spouse.id, sharePercent: 60 } });
        await db.nominee.create({ data: { employeeId: row.id, scheme, familyMemberId: child.id, sharePercent: 40 } });
        await db.nominee.create({ data: { employeeId: row.id, scheme: "GRATUITY", familyMemberId: spouse.id, sharePercent: 100 } });
      }
      await db.serviceBookEntry.create({
        data: {
          employeeId: row.id,
          event: "APPOINTMENT",
          eventDate: fromISODate(e.doj),
          orderNumber: `DCB/EST/${e.doj.slice(0, 4)}/${100 + i}`,
          orderDate: fromISODate(e.doj),
          details: `Appointed as ${POSTS.find((p) => p[0] === e.post)![1]} in ${SECTIONS.find((x) => x[0] === e.section)![1]}.`,
          detailsHi: `${POSTS.find((p) => p[0] === e.post)![2]} के पद पर ${SECTIONS.find((x) => x[0] === e.section)![2]} में नियुक्ति।`,
          status: "APPROVED",
          createdById: "seed",
        },
      });
    }
  }

  // Sanctioned strength (EM-09): a little above today's staff so vacancies show; one post deliberately short.
  const filled = await db.employee.groupBy({
    by: ["sectionId", "postId"],
    where: { boardId: board.id, type: { in: ["PERMANENT_OPS", "PERMANENT_NPS", "DEPUTATION"] }, status: { in: ["ACTIVE", "SUSPENDED"] } },
    _count: { _all: true },
  });
  for (const [i, f] of filled.entries()) {
    await db.sanctionedPost.upsert({
      where: { boardId_sectionId_postId: { boardId: board.id, sectionId: f.sectionId, postId: f.postId } },
      create: { boardId: board.id, sectionId: f.sectionId, postId: f.postId, sanctioned: f._count._all + (i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0), orderRef: "MoD letter 2019 (demo)" },
      update: {},
    });
  }

  for (const u of USERS) {
    const data = {
      boardId: board.id,
      loginType: u.loginType,
      loginId: u.loginId,
      displayName: u.name,
      displayNameHi: u.nameHi,
      mobile: u.mobile,
      employeeId: u.employee ? employeeIds.get(u.employee)! : null,
      permissions: u.permissions,
      passwordHash,
      mustChangePassword: false,
    };
    await db.user.upsert({
      where: { boardId_loginType_loginId: { boardId: board.id, loginType: u.loginType, loginId: u.loginId } },
      create: data,
      update: { displayName: data.displayName, displayNameHi: data.displayNameHi, permissions: data.permissions, employeeId: data.employeeId },
    });
  }

  // Attendance: holidays, working weeks, a device, two months of punches and locks (Module 4).
  const employeeLogins = await db.user.findMany({ where: { boardId: board.id, loginType: "EMPLOYEE" }, select: { id: true, loginId: true, displayName: true } });
  const hrUser = await db.user.findUniqueOrThrow({ where: { boardId_loginType_loginId: { boardId: board.id, loginType: "HR_ACCOUNTS", loginId: "DCB10003" } } });
  await seedAttendance(
    db,
    board.id,
    EMPLOYEES.map((e) => ({ id: employeeIds.get(e.code)!, code: e.code, sectionCode: e.section, sectionId: sectionIds.get(e.section)!, doj: e.doj, gender: e.gender, type: e.type })),
    new Map(employeeLogins.map((u) => [u.loginId, { id: u.id, name: u.displayName }])),
    { id: hrUser.id, name: hrUser.displayName },
  );

  // Payroll: standing pay items and the last two months closed (Module 6).
  const userOf = async (loginId: string) => {
    const u = await db.user.findUniqueOrThrow({ where: { boardId_loginType_loginId: { boardId: board.id, loginType: loginId === "DCB10002" ? "ADMIN" : "HR_ACCOUNTS", loginId } } });
    return { id: u.id, name: u.displayName };
  };
  await seedPayrollDemo(db, board.id, employeeIds, { payroll: await userOf("DCB10004"), checker: await userOf("DCB10006"), signer: await userOf("DCB10002") });

  // Pension: pensioners from the old system and the last two pension bills closed (Module 9).
  const thisMonth = todayIST().slice(0, 7);
  await seedPensionDemo(db, board.id, {
    seal: (kind, value) => sealWith(ENC_KEY, IDX_KEY, kind, value),
    sections: sectionIds,
    posts: postIds,
    months: [shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1)],
    users: { pension: await userOf("DCB10005"), checker: await userOf("DCB10006"), signer: await userOf("DCB10002") },
    passwordHash,
  });

  // A demo vacancy (advertised, with applicants) so the recruitment screens have something to show.
  if ((await db.vacancy.count({ where: { boardId: board.id } })) === 0) {
    const rev = sectionIds.get("REV")!;
    const ldc = postIds.get("LDC")!;
    await db.sanctionedPost.upsert({
      where: { boardId_sectionId_postId: { boardId: board.id, sectionId: rev, postId: ldc.id } },
      create: { boardId: board.id, sectionId: rev, postId: ldc.id, sanctioned: 4, orderRef: "MoD letter 2019 (demo)" },
      update: { sanctioned: 4 },
    });
    const vacancy = await db.vacancy.create({
      data: {
        boardId: board.id,
        referenceNo: "DCB/REC/2026/001",
        sectionId: rev,
        postId: ldc.id,
        payLevel: "2",
        seats: 2,
        reservation: { GEN: 1, OBC: 1, SC: 0, ST: 0, EWS: 0 },
        advertNumber: "DCB/ADV/07/2026",
        advertDate: fromISODate("2026-08-14"),
        lastDate: fromISODate("2026-09-15"),
        status: "ADVERTISED",
        createdById: "seed",
      },
    });
    const applicants: [string, string, string, string, string, string][] = [
      ["Kiran Bala", "किरण बाला", "F", "1998-06-14", "OBC", "9811200001"],
      ["Rohit Saxena", "रोहित सक्सेना", "M", "1997-03-02", "GEN", "9811200002"],
      ["Anjali Meena", "अंजलि मीणा", "F", "1999-11-23", "ST", "9811200003"],
      ["Farhan Ali", "फ़रहान अली", "M", "1996-01-30", "GEN", "9811200004"],
    ];
    for (const [i, [name, nameHi, gender, dob, category, mobile]] of applicants.entries()) {
      await db.applicant.create({
        data: { vacancyId: vacancy.id, applicationNo: `A-${String(i + 1).padStart(4, "0")}`, name, nameHi, gender, dateOfBirth: fromISODate(dob), category, mobile, qualification: "Graduate, typing 35 wpm", status: i < 3 ? "SHORTLISTED" : "APPLIED" },
      });
    }
    await db.sequence.upsert({ where: { boardId_name: { boardId: board.id, name: "vacancy-2026" } }, create: { boardId: board.id, name: "vacancy-2026", next: 2 }, update: {} });
    await db.sequence.upsert({ where: { boardId_name: { boardId: board.id, name: `applicant-${vacancy.id}` } }, create: { boardId: board.id, name: `applicant-${vacancy.id}`, next: 5 }, update: {} });
  }

  await db.sequence.upsert({
    where: { boardId_name: { boardId: board.id, name: "employee" } },
    create: { boardId: board.id, name: "employee", next: 10000 + EMPLOYEES.length + 1 },
    update: {},
  });

  console.log(`Seeded Board ${board.code}: ${SECTIONS.length} sections, ${POSTS.length} posts, ${EMPLOYEES.length} employees, ${USERS.length} demo logins (password ${DEMO_PASSWORD}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
