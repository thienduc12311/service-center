import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { translatorFor } from '@service-center/shared';
import { AccountMenuButton } from './AccountMenuButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../i18n', () => ({
  useErrorText: () => () => 'error',
}));

afterEach(cleanup);

describe('AccountMenuButton', () => {
  const photo = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

  it.each([
    ['en', 'Account menu', null],
    ['en', 'Account menu', photo],
    ['vi', 'Trình đơn tài khoản', null],
    ['vi', 'Trình đơn tài khoản', photo],
  ] as const)('exposes the localized name in %s (%s) with avatar %s', (locale, expectedName, avatarUrl) => {
    render(
      <AccountMenuButton
        label={translatorFor(locale, 'home')('shell.accountMenu')}
        name="QA Wave5 Owner"
        avatarUrl={avatarUrl}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: expectedName });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
