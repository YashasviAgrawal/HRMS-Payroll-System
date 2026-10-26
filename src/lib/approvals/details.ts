/** Shape of ApprovalTask.details — what the checker sees before deciding. */
export interface ApprovalDetails {
  /** Old → new rows (an edit) or label → value rows (old left empty). */
  rows?: { label: string; labelHi?: string; old?: string | null; new?: string | null }[];
  /** A link to the full record, e.g. the employee profile. */
  link?: string;
  /** Short explanation shown above the rows. */
  summary?: string;
  summaryHi?: string;
}
