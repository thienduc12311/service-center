import { cleanup, render, screen } from '@testing-library/react';
import type { DiscussionMention } from '@service-center/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageText } from './MessageText';

const me: DiscussionMention = { person_id: 'p-me', name: 'Olive Owner', resolution: 'notified', is_me: true };

afterEach(cleanup);

describe('MessageText', () => {
  it('shows typed HTML as text, never as markup', () => {
    const { container } = render(<p><MessageText text={'<b>bold</b> & "quote"'} mentions={[]} /></p>);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b>bold</b> & "quote"');
  });

  it('formats bold, italic, strike and code without the markers', () => {
    const { container } = render(<p><MessageText text="**b** _i_ ~~s~~ `c`" mentions={[]} /></p>);
    expect(container.textContent).toBe('b i s c');
    expect(screen.getByText('b').className).toContain('font-semibold');
    expect(screen.getByText('i').className).toContain('italic');
    expect(screen.getByText('s').className).toContain('line-through');
    expect(screen.getByText('c').className).toContain('font-mono');
  });

  it('links http(s) URLs to a new tab without opener access', () => {
    render(<p><MessageText text="see https://example.com." mentions={[]} /></p>);
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('draws a mention of the reader in amber', () => {
    render(<p><MessageText text="thanks **@Olive Owner**" mentions={[me]} /></p>);
    const pill = screen.getByText('@Olive Owner');
    expect(pill.className).toContain('bg-amber-200');
    expect(pill.className).toContain('font-semibold');
  });
});
