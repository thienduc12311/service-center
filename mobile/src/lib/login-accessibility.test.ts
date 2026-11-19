import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native login input names (source contract)', () => {
  const login = readFileSync(new URL('../../app/(auth)/login.tsx', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../components/ui.tsx', import.meta.url), 'utf8');

  it('uses the localized visible label as the native input name independently of the value', () => {
    expect(login).toMatch(/<Field\s+label=\{t\('login\.fields\.email'\)\}\s+value=\{email\}/);
    expect(login).toMatch(/<Field\s+label=\{t\('login\.fields\.password'\)\}\s+value=\{password\}/);
    const field = ui.slice(ui.indexOf('export const Field ='), ui.indexOf("Field.displayName = 'Field'"));
    expect(field).toMatch(/<TextInput\s[\s\S]*?accessibilityLabel=\{props\.accessibilityLabel \?\? label\}/);
  });
});
