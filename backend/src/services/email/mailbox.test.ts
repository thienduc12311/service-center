import { describe, expect, it } from 'vitest';
import { config } from '../../config.js';
import { mailbox } from './mailbox.js';

const address = config.MAIL_FROM_ADDRESS;

describe('mailbox', () => {
  it('quotes a plain display name', () => {
    expect(mailbox('Grace Church')).toBe(`"Grace Church" <${address}>`);
  });

  it('keeps a comma or angle brackets inside the quotes', () => {
    expect(mailbox('Grace Church, Springfield')).toBe(`"Grace Church, Springfield" <${address}>`);
    expect(mailbox('Pastor <pastor@evil.example>')).toBe(`"Pastor <pastor@evil.example>" <${address}>`);
  });

  it('escapes quotes and backslashes', () => {
    expect(mailbox('The "Rock" \\ Church')).toBe(`"The \\"Rock\\" \\\\ Church" <${address}>`);
  });

  it('folds line breaks so no header can be injected', () => {
    expect(mailbox('Grace\r\nBcc: victim@example.test')).toBe(`"Grace Bcc: victim@example.test" <${address}>`);
  });

  it('falls back to the bare address for an empty name', () => {
    expect(mailbox('  \n ')).toBe(address);
  });
});
