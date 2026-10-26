/** Punch file formats and the column headings each understands (AT-01). Shared by the server parser and the import screen. */
export const PUNCH_FORMATS = ["ESSL", "ZKTECO", "MANTRA", "AEBAS", "TEMPLATE"] as const;
export type PunchFormat = (typeof PUNCH_FORMATS)[number];

export interface FormatDef {
  /** Headings as the export usually prints them — shown on the import screen. */
  sample: string[];
  id: string[];
  /** One column with date and time together… */
  dateTime?: string[];
  /** …or separate date and time columns. */
  date?: string[];
  time?: string[];
  /** AEBAS reports carry in and out times on one row. */
  inTime?: string[];
  outTime?: string[];
}

const ID = ["biometricid", "employeecode", "empcode", "employeeid", "empid", "empno", "employeeno", "userid", "pin", "enrollno", "enrollmentno", "personid", "attendanceid", "acno", "cardno"];

export const FORMAT_DEFS: Record<PunchFormat, FormatDef> = {
  // eSSL eTimeTrackLite / Smart Office "Device logs" export.
  ESSL: { sample: ["Employee Code", "Log Date"], id: ID, dateTime: ["logdate", "logdatetime", "punchtime", "punchdatetime", "datetime", "logtime"], date: ["date", "attendancedate"], time: ["time", "punch"] },
  // ZKTeco USB attlog.dat (no headings) or ZKBioTime / ZKTime "Transaction" export.
  ZKTECO: { sample: ["attlog.dat", "Person ID", "Punch Time"], id: ID, dateTime: ["punchtime", "datetime", "time", "checktime", "transactiontime"], date: ["date"], time: ["checkin", "punch"] },
  // Mantra attendance software export: date and time in separate columns.
  MANTRA: { sample: ["EmpCode", "Date", "Time"], id: ID, dateTime: ["datetime", "punchtime"], date: ["date", "punchdate", "attdate"], time: ["time", "punchtime"] },
  // AEBAS (attendance.gov.in) daily report: one row per person per day with in and out times.
  AEBAS: { sample: ["Attendance ID", "Date", "In Time", "Out Time"], id: ID, date: ["date", "attendancedate", "day"], inTime: ["intime", "in", "firstin"], outTime: ["outtime", "out", "lastout"] },
  // The Board's own template (Biometric ID, Date, Time).
  TEMPLATE: { sample: ["Biometric ID", "Date", "Time"], id: ID, date: ["date"], time: ["time"], dateTime: ["datetime"] },
};

