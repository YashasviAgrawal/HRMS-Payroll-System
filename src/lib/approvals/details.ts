/** Shape of ApprovalTask.details — what the checker sees before deciding. */
export interface ApprovalDetails {
  /** Old → new rows (an edit) or label → value rows (old left empty). */
  rows?: { label: string; labelHi?: string; old?: string | null; new?: string | null; reveal?: "pan" | "bankAccount" }[];
  /** A link to the full record, e.g. the employee profile. */
  link?: string;
  /** Short explanation shown above the rows. */
  summary?: string;
  summaryHi?: string;
  /** Decided on its own screen (e.g. a payroll with OTP), not with the generic buttons. */
  decideAt?: string;
}
