import { z } from 'zod';

/** What an optional secret must look like to be used. */
export interface OptionalSecretRule {
  /** Environment variable name, used in the warning (never the value). */
  name: string;
  isValid: (value: string) => boolean;
  /** Human-readable requirement, e.g. "at least 16 characters". */
  requirement: string;
}

/**
 * An optional secret that can never stop the API from starting. Empty means
 * unset; a value that breaks its rule is ignored (treated as unset) and
 * reported through `warn`, so only the feature that needs it stays off.
 */
export const optionalSecret = (rule: OptionalSecretRule, warn: (message: string) => void) =>
  z
    .string()
    .optional()
    .transform((value): string | undefined => {
      if (!value) return undefined;
      if (rule.isValid(value)) return value;
      warn(`[config] ${rule.name} ignored: must be ${rule.requirement}. Features that need it stay off.`);
      return undefined;
    });
