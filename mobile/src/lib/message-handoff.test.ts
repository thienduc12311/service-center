import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openURL = vi.fn<(url: string) => Promise<void>>();
vi.mock('react-native', () => ({ Linking: { openURL: (url: string) => openURL(url) }, Platform: { OS: 'ios' } }));

const { openTextComposer, textComposerPlatform } = await import('./message-handoff');

describe('openTextComposer', () => {
  beforeEach(() => {
    openURL.mockReset();
  });

  it('opens the device composer with the reviewed numbers and text, and reports only whether it opened', async () => {
    openURL.mockResolvedValue(undefined);
    await expect(openTextComposer(['+15550102000', '5550100'], 'Call time 9 & bring water')).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('sms:/open?addresses=+15550102000,5550100&body=Call%20time%209%20%26%20bring%20water');
    openURL.mockImplementation(async () => { throw new Error('No app'); });
    await expect(openTextComposer(['5550100'], 'x')).resolves.toBe(false);
  });

  it('uses the Android link form on every non-iOS platform', () => {
    expect(textComposerPlatform('ios')).toBe('ios');
    expect(textComposerPlatform('android')).toBe('android');
  });
});

describe('native message screens source', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...parts), 'utf8');
  const compose = read('messages', 'compose.tsx');
  const detail = read('messages', '[id].tsx');
  const handoff = readFileSync(join(__dirname, 'message-handoff.ts'), 'utf8');

  it('sends once through the shared body with one key per composed message', () => {
    expect(compose.match(/api\.sendMessage\(/g)).toHaveLength(1);
    expect(compose).toContain('messageSendBody(');
    expect(compose).toContain('useRef(newIdempotencyKey())');
    // The key is never replaced, so a changed resend after a lost answer is refused, not duplicated.
    expect(compose).not.toMatch(/sendKey\.current\s*=/);
    expect(compose).not.toMatch(/\.(map|forEach)\([^)]*sendMessage/s);
  });

  it('only sends after a preview of the same selection', () => {
    expect(compose).toMatch(/const canSend = Boolean\(preview\)/);
    // Changing who receives it drops the preview, so the reviewed hash always matches the selection.
    expect(compose).toMatch(/const changeAudience = [\s\S]*?setPreview\(null\)/);
  });

  it('hands texts to the OS without any server write or SMS provider', () => {
    expect(handoff).not.toMatch(/from '\.\/api'|fetch\(/);
    const textSection = compose.slice(compose.indexOf('function TextHandoff'));
    expect(textSection.match(/api\.\w+\(/g)).toEqual(['api.listPeople(']);
    expect(textSection).toContain('textHandoffRecipients(');
    expect(textSection).toContain('textHandoffBody(');
  });

  it('retries outcomes through the server retry, never by sending again', () => {
    expect(detail).toContain('api.retryMessage(');
    expect(detail).not.toContain('api.sendMessage(');
  });
});
