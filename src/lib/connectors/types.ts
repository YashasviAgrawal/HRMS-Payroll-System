/**
 * Integration connectors (PRD §12). Each integration has one interface and two modes:
 * "file" today (the system builds a file, a named person uploads it) and "api" later, so a live API can
 * replace the file without changing any screen. A failed integration never blocks payroll — the file can
 * always be downloaded instead (rule 8).
 */
export type ConnectorMode = "file" | "api";

export interface ConnectorInfo {
  id: string;
  name: string;
  mode: ConnectorMode;
  /** What Release 2/3 will switch on, shown on the Settings screen. */
  later?: string;
}

export const CONNECTORS: ConnectorInfo[] = [
  { id: "sms", name: "SMS and email gateway", mode: "api" },
  { id: "bank", name: "Salary bank", mode: "file", later: "Host-to-host, penny-drop (Release 2)" },
  { id: "echhawani", name: "e-Chhawani finance (DGDE)", mode: "file", later: "API posting (Release 2)" },
  { id: "nps", name: "NPS CRA", mode: "file", later: "CRA API (Release 2/3)" },
  { id: "tds", name: "Income tax (Protean / TRACES)", mode: "file", later: "PAN verification (Release 2)" },
  { id: "epfo-esic", name: "EPFO and ESIC", mode: "file", later: "Portal upload automation (Release 2)" },
  { id: "biometric", name: "Biometric devices and AEBAS", mode: "file", later: "AEBAS API, field app (Release 2)" },
  { id: "jeevan-pramaan", name: "Jeevan Pramaan", mode: "file", later: "API status import (Release 2)" },
  { id: "signature", name: "Digital signature", mode: "file", later: "DSC / Aadhaar eSign (Release 2)" },
];
