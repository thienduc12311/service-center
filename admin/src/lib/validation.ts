/** The part of a Zod issue the forms read (structural, so this app needs no direct zod import). */
export interface ValidationIssue {
  path: readonly (string | number)[];
  message: string;
}

/** Field name → first message, for showing beside each input. */
export type FieldErrors = Readonly<Record<string, string>>;

/** The first message for each top-level field; form-wide issues go under `''`. */
export const fieldErrorsFrom = (issues: readonly ValidationIssue[]): FieldErrors => {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (!(field in errors)) errors[field] = issue.message;
  }
  return errors;
};
