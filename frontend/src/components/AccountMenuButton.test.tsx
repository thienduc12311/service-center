import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import enHome from '../../../packages/shared/src/i18n/locales/en/home.json';
import viHome from '../../../packages/shared/src/i18n/locales/vi/home.json';
import { AccountMenuButton } from './AccountMenuButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../i18n', () => ({
  useErrorText: () => () => 'error',
}));

afterEach(cleanup);

describe('AccountMenuButton', () => {
  it.each([
    ['English initials', enHome.shell.accountMenu, null],
    ['English photo', enHome.shell.accountMenu, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='],
    ['Vietnamese initials', viHome.shell.accountMenu, null],
    ['Vietnamese photo', viHome.shell.accountMenu, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='],
  ])('has a stable localized name at a narrow viewport: %s', (_variant, label, avatarUrl) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

    render(
      <AccountMenuButton
        label={label}
        name="QA Wave5 Owner"
        avatarUrl={avatarUrl}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: label });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
