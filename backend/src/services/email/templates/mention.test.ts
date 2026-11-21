import { describe, expect, it } from 'vitest';
import { mentionEmail } from './mention.js';
import type { MentionEmailNotification } from '../../notifications.js';

const base: MentionEmailNotification = {
  to: 'riley@example.test',
  locale: 'en',
  personName: 'Riley',
  organizationName: 'Riverside',
  authorName: 'Sam <b>Lee</b>',
  place: 'Band chat',
  excerpt: 'Can you bring the capo?\n<script>alert(1)</script>',
  moreCount: 0,
  threadUrl: 'https://app.test/chat/c1?a=1&b=2',
};

describe('mentionEmail', () => {
  it('names the author and place, quotes the escaped excerpt and links to the thread', () => {
    const content = mentionEmail(base);
    expect(content.subject).toBe('Sam <b>Lee</b> mentioned you in Band chat');
    expect(content.html).not.toContain('<script>');
    expect(content.html).not.toContain('<b>Lee');
    expect(content.html).toContain('Can you bring the capo?<br>&lt;script&gt;');
    expect(content.html).toContain('href="https://app.test/chat/c1?a=1&amp;b=2"');
    expect(content.text).toContain('Hi Riley,');
    expect(content.text).toContain('> Can you bring the capo?\n> <script>alert(1)</script>');
    expect(content.text).toContain('https://app.test/chat/c1?a=1&b=2');
    expect(content.text).toContain('Notification preferences');
    expect(content.text).not.toContain('more mention');
  });

  it('counts the other mentions it covers', () => {
    expect(mentionEmail({ ...base, moreCount: 1 }).text).toContain('and 1 more mention');
    expect(mentionEmail({ ...base, moreCount: 3 }).html).toContain('and 3 more mentions');
  });

  it('is written in the recipient language, keeping authored text as written', () => {
    const content = mentionEmail({ ...base, locale: 'vi', personName: null, moreCount: 2 });
    expect(content.subject).toBe('Sam <b>Lee</b> đã nhắc đến bạn trong Band chat');
    expect(content.text).toContain('và 2 lần nhắc khác');
    expect(content.text).toContain('Tùy chọn thông báo');
  });

  it('keeps the subject on one line', () => {
    expect(mentionEmail({ ...base, place: 'Band\nchat' }).subject).toBe('Sam <b>Lee</b> mentioned you in Band chat');
  });
});
