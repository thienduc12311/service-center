import { describe, expect, it } from 'vitest';
import { parseAppearanceMode, resolveAppearance } from './appearance.js';

describe('appearance', () => {
  it('reads light and dark, and treats anything else as system', () => {
    expect(parseAppearanceMode('light')).toBe('light');
    expect(parseAppearanceMode('dark')).toBe('dark');
    expect(parseAppearanceMode('system')).toBe('system');
    expect(parseAppearanceMode(null)).toBe('system');
    expect(parseAppearanceMode('Dark')).toBe('system');
  });

  it('keeps an explicit choice whatever the OS says', () => {
    expect(resolveAppearance('light', 'dark')).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
  });

  it('follows the OS in system mode and falls back to light', () => {
    expect(resolveAppearance('system', 'dark')).toBe('dark');
    expect(resolveAppearance('system', 'light')).toBe('light');
    expect(resolveAppearance('system', null)).toBe('light');
    expect(resolveAppearance('system', 'unspecified')).toBe('light');
  });
});
