import { describe, expect, it } from 'vitest';
import { operationalMessageEmail } from './operational-message.js';

describe('operationalMessageEmail', () => {
  it('escapes sender text and variable values, keeps paragraphs and the reply hint', () => {
    const content = operationalMessageEmail({
      to: 'sam@example.com',
      personName: 'Sam',
      organizationName: 'Riverside',
      subject: 'Parking for\n<Sunday>',
      body: 'Hi <img src=x onerror=alert(1)>,\npark in lot B.\n\nThanks & see you',
      senderName: 'Jordan "JB" Blake',
      messageUrl: 'https://app.example/messages/1?a=1&b=2',
    });
    expect(content.subject).toBe('Parking for <Sunday>');
    expect(content.html).not.toContain('<img');
    expect(content.html).toContain('Hi &lt;img src=x onerror=alert(1)&gt;,<br>park in lot B.');
    expect(content.html).toContain('<p>Thanks &amp; see you</p>');
    expect(content.html).toContain('href="https://app.example/messages/1?a=1&amp;b=2"');
    expect(content.text).toContain('Reply to this email to reach them.');
    expect(content.html).toContain('Jordan &quot;JB&quot; Blake');
  });
});
