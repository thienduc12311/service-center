import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Messages tab (source contract)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const tabs = read('app', '(tabs)', '_layout.tsx');
  const inbox = read('app', '(tabs)', 'inbox.tsx');
  const profile = read('app', '(tabs)', 'profile.tsx');

  it('adds a Messages tab before Settings with Chat and Messages behind one switch', () => {
    expect(tabs.indexOf('name="inbox"')).toBeGreaterThan(tabs.indexOf('name="songs"'));
    expect(tabs.indexOf('name="inbox"')).toBeLessThan(tabs.indexOf('name="profile"'));
    expect(inbox).toContain("{ value: 'chat', label: t('nav.chat') }");
    expect(inbox).toContain("{ value: 'messages', label: t('nav.messages') }");
    expect(inbox).toContain('<ChatList header={header} />');
    expect(inbox).toContain('<MessageList header={header} />');
  });

  it('keeps /chat and /messages on the same lists, and drops the duplicate Settings rows', () => {
    expect(read('app', 'chat', 'index.tsx')).toContain('<ChatList />');
    expect(read('app', 'messages', 'index.tsx')).toContain('<MessageList />');
    expect(profile).not.toContain("router.push('/chat')");
    expect(profile).not.toContain("router.push('/messages')");
  });
});
