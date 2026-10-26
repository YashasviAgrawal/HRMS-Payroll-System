/** Shared by the browser and the server so both give the same message. */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordProblem = "too_short" | "needs_letter" | "needs_number";

export function checkPassword(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push("too_short");
  if (!/[A-Za-z]/.test(password)) problems.push("needs_letter");
  if (!/[0-9]/.test(password)) problems.push("needs_number");
  return problems;
}
