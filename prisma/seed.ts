/**
 * Seed data.
 *  - Always: the Board, its sections and posts, and a first User & settings manager (so someone can log in).
 *  - Outside production (or with SEED_DEMO=1): demo employees and one login for every role, for training
 *    and testing. Demo password for every login: Dcb@2026
 *
 * Safe to run more than once (upserts by natural keys).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { EmployeeType, LoginType, Permission } from "../src/generated/prisma/enums";
import { fromISODate, retirementDate } from "../src/lib/dates";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DEMO = process.env.NODE_ENV !== "production" || process.env.SEED_DEMO === "1";
const DEMO_PASSWORD = "Dcb@2026";

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
  { code: "DCB10014", first: "Pooja", last: "Bhatia", hi: "पूजा भाटिया", gender: "F", dob: "1993-03-28", doj: "2019-07-01", section: "EDU", post: "PRT", type: "PERMANENT_NPS", cell: 5, mobile: "9810000014" },
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
  for (const e of EMPLOYEES) {
    const post = postIds.get(e.post)!;
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
      dateOfRetirement: fromISODate(retirementDate(e.dob, e.type === "REEMPLOYED" ? 65 : post.retirementAge)),
      sectionId: sectionIds.get(e.section)!,
      postId: post.id,
      payLevel: e.cell ? post.level : null,
      payCell: e.cell ?? null,
      mobile: e.mobile,
    };
    const row = await db.employee.upsert({ where: { boardId_employeeCode: { boardId: board.id, employeeCode: e.code } }, create: data, update: data });
    employeeIds.set(e.code, row.id);
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
