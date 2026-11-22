import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ItemDetailsView } from './ItemDetailsView';

afterEach(cleanup);

const renderDetails = (markdown: string) => render(<ItemDetailsView markdown={markdown} />).container;

describe('ItemDetailsView (XSS-safe renderer)', () => {
  it('renders headings, lists, emphasis and safe links', () => {
    const root = renderDetails('# Title\n## Sub\nPlain **bold** _it_\n\n- one\n- two\n\n3. three\n4. four\n\nMail [us](mailto:team@example.com)');
    expect(root.querySelector('h3')?.textContent).toBe('Title');
    expect(root.querySelector('h4')?.textContent).toBe('Sub');
    expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelector('span.font-semibold')?.textContent).toBe('bold');
    expect(root.querySelector('.italic')?.textContent).toBe('it');
    const link = root.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('mailto:team@example.com');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('never renders typed HTML or unsafe link targets', () => {
    const payloads = [
      '<script>window.__xss = 1</script>',
      '<img src=x onerror="window.__xss = 1">',
      '<a href="javascript:alert(1)">click</a>',
      '[click](javascript:alert(1))',
      '[data](data:text/html;base64,PHNjcmlwdD4=)',
      '[vb](vbscript:msgbox)',
      '[rel](/admin)',
      '<iframe src="https://evil.example"></iframe>',
      '<svg onload=alert(1)>',
    ];
    const root = renderDetails(payloads.join('\n'));
    for (const tag of ['script', 'img', 'iframe', 'svg']) expect(root.querySelector(tag)).toBeNull();
    // Only the bare https URL in the iframe text becomes a (safe) link; no script, data, vbscript or relative targets.
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://evil.example']);
    expect(root.querySelector('[onerror], [onload]')).toBeNull();
    expect(root.textContent).toContain('<script>window.__xss = 1</script>');
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('renders nothing for blank details', () => {
    expect(renderDetails('   \n').innerHTML).toBe('');
  });
});
