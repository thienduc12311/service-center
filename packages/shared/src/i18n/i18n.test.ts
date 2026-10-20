import { describe, expect, it } from 'vitest';
import { createI18n, translateMessage, translatorFor } from './engine.js';
import { formatCalendarDate, formatInstantDate, formatInstantDateTime, formatInstantTime, weekdayNames } from './format.js';
import { createLocaleRegistry, localeRegistry, normalizeLocale, type LocaleDefinition } from './locales.js';
import { resolveLocale, resolveRecipientLocale } from './resolve-locale.js';
import { NAMESPACES, englishResources, resources, type CatalogTree, type LocaleResources } from './resources.js';
import { validateCatalogs } from './validate.js';
import { presentError } from './errors.js';
import type { TranslatableMessage } from './types.js';

/** A key that is deliberately absent from the typed English contract. */
const untypedMessage = (key: string): TranslatableMessage => ({ key } as unknown as TranslatableMessage);
import { ApiError } from '../lib/api-client.js';

describe('shipped catalogs', () => {
  it('pass release validation (keys, plural forms, placeholders, no markup)', () => {
    expect(validateCatalogs({ resources, namespaces: NAMESPACES, reference: 'en' })).toEqual([]);
  });

  it('register every namespace for every language', () => {
    for (const locale of localeRegistry.codes) {
      expect(Object.keys(resources[locale]).sort()).toEqual([...NAMESPACES].sort());
    }
  });
});

describe('validateCatalogs', () => {
  const en: Record<string, CatalogTree> = {
    ns: { greeting: 'Hi {{name}}', items_one: '{{count}} item', items_other: '{{count}} items', plain: 'Plain' },
  };

  it('accepts Vietnamese with only the _other plural form', () => {
    const vi = { ns: { greeting: 'Chào {{name}}', items_other: '{{count}} mục', plain: 'Thường' } };
    expect(validateCatalogs({ resources: { en, vi }, namespaces: ['ns'], reference: 'en' })).toEqual([]);
  });

  it('detects missing keys, missing namespaces and extra keys', () => {
    const vi = { ns: { greeting: 'Chào {{name}}', items_other: '{{count}} mục', extra: 'x' } };
    const kinds = validateCatalogs({ resources: { en, vi }, namespaces: ['ns', 'other'], reference: 'en' }).map((issue) => `${issue.locale}:${issue.kind}:${issue.key}`);
    expect(kinds).toContain('vi:missing_key:plain');
    expect(kinds).toContain('vi:extra_key:extra');
    expect(kinds).toContain('vi:missing_namespace:');
  });

  it('detects incompatible plural forms for the language', () => {
    const vi = { ns: { greeting: 'Chào {{name}}', items_one: '{{count}} mục', plain: 'Thường' } };
    const issues = validateCatalogs({ resources: { en, vi }, namespaces: ['ns'], reference: 'en' });
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['missing_plural_form', 'unexpected_plural_form']));
    const enOnlyOther = { ns: { ...en.ns, items_one: undefined } } as unknown as Record<string, CatalogTree>;
    delete (enOnlyOther.ns as Record<string, unknown>).items_one;
    expect(validateCatalogs({ resources: { en: enOnlyOther }, namespaces: ['ns'], reference: 'en' }).map((issue) => issue.kind)).toContain('missing_plural_form');
  });

  it('detects mismatched interpolation, unescaped values and markup', () => {
    const vi = { ns: { greeting: 'Chào {{ten}}', items_other: '{{- count}} mục', plain: '<b>Thường</b>' } };
    const kinds = validateCatalogs({ resources: { en, vi }, namespaces: ['ns'], reference: 'en' }).map((issue) => issue.kind);
    expect(kinds).toEqual(expect.arrayContaining(['placeholder_mismatch', 'unescaped_interpolation', 'markup']));
  });
});

describe('runtime translation', () => {
  it('renders Vietnamese diacritics, interpolated names and zero/one/many counts', () => {
    const vi = translatorFor('vi', 'common');
    const en = translatorFor('en', 'common');
    expect(vi('language.label')).toBe('Ngôn ngữ');
    expect(vi('a11y.avatarOf', { name: 'Nguyễn Thị Ánh' })).toBe('Ảnh của Nguyễn Thị Ánh');
    expect([0, 1, 5].map((count) => en('count.people', { count }))).toEqual(['0 people', '1 person', '5 people']);
    expect([0, 1, 5].map((count) => vi('count.people', { count }))).toEqual(['0 người', '1 người', '5 người']);
    expect(en('duration.inDays', { count: 0 })).toBe('today');
    expect(vi('duration.inDays', { count: 3 })).toBe('3 ngày nữa');
  });

  it('treats interpolated values as text (no escaping into entities, no nesting)', () => {
    const en = translatorFor('en', 'common');
    expect(en('a11y.avatarOf', { name: '<img src=x> {{other}} $t(app.name)' })).toBe('Picture of <img src=x> {{other}} $t(app.name)');
  });

  it('keeps per-recipient translators independent under concurrency', async () => {
    const render = async (locale: 'en' | 'vi', delay: number) => {
      const t = translatorFor(locale, 'notifications');
      await new Promise((resolve) => setTimeout(resolve, delay));
      return t('feed.scheduled', { plan: 'Sunday' });
    };
    const results = await Promise.all([render('vi', 5), render('en', 0), render('vi', 0), render('en', 5)]);
    expect(results).toEqual([
      'Bạn được phân công cho Sunday',
      "You're scheduled for Sunday",
      'Bạn được phân công cho Sunday',
      "You're scheduled for Sunday",
    ]);
  });

  it('falls back to English for a missing translation and never shows a raw key', () => {
    const catalogs = {
      en: { ...englishResources, common: { only: { english: 'English only' } } },
      vi: { ...resources.vi, common: {} },
    } as unknown as Record<'en' | 'vi', LocaleResources>;
    const missing: string[] = [];
    const instance = createI18n({ locale: 'vi', catalogs, onMissingKey: (_l, ns, key) => missing.push(`${ns}:${key}`) });
    expect(translateMessage(instance, untypedMessage('common:only.english'))).toBe('English only');
    expect(translateMessage(instance, untypedMessage('common:does.not.exist'))).toBe('');
    expect(missing).toContain('common:does.not.exist');
  });
});

describe('locale normalization and resolution', () => {
  it('normalizes regional and cased tags, rejecting unsupported ones', () => {
    expect(normalizeLocale('vi-VN')).toBe('vi');
    expect(normalizeLocale('EN_us')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
  });

  it('prefers the saved preference over the device for members', () => {
    expect(resolveLocale({ member: true, saved: 'en', detected: ['vi-VN'] })).toMatchObject({ locale: 'en', source: 'saved' });
    expect(resolveLocale({ member: true, saved: 'vi', detected: ['en-US'] })).toMatchObject({ locale: 'vi', source: 'saved' });
  });

  it('treats null as Automatic: first supported device language, then English', () => {
    expect(resolveLocale({ member: true, saved: null, detected: ['fr-FR', 'vi-VN'] })).toMatchObject({ locale: 'vi', source: 'device' });
    expect(resolveLocale({ member: true, saved: null, detected: ['fr-FR', 'de'] })).toMatchObject({ locale: 'en', source: 'fallback' });
  });

  it('ignores the anonymous device choice for members, and uses it when signed out', () => {
    expect(resolveLocale({ member: true, saved: null, anonymous: 'vi', detected: ['en-US'] }).locale).toBe('en');
    expect(resolveLocale({ member: false, anonymous: 'vi', detected: ['en-US'] })).toMatchObject({ locale: 'vi', source: 'anonymous' });
  });

  it('shows English for a saved code this client does not know, and reports it', () => {
    expect(resolveLocale({ member: true, saved: 'fr', detected: ['vi-VN'] })).toEqual({ locale: 'en', source: 'fallback', unsupportedSaved: 'fr' });
  });

  it('uses a verified token recipient preference on signed-out pages only', () => {
    expect(resolveLocale({ member: false, recipient: 'vi', anonymous: 'en', detected: ['en'] })).toMatchObject({ locale: 'vi', source: 'recipient' });
    expect(resolveLocale({ member: true, saved: null, recipient: 'vi', detected: ['en'] }).locale).toBe('en');
  });

  it('resolves system recipients to their explicit preference, then English', () => {
    expect(resolveRecipientLocale('vi')).toBe('vi');
    expect(resolveRecipientLocale(null)).toBe('en');
    expect(resolveRecipientLocale('fr')).toBe('en');
  });
});

describe('a test-only third language', () => {
  const definitions: LocaleDefinition<'en' | 'vi' | 'xx'>[] = [
    ...localeRegistry.definitions,
    { code: 'xx', nativeName: 'Test language', englishName: 'Test', formatLocale: 'en-GB', direction: 'ltr' },
  ];
  const registry = createLocaleRegistry(definitions);

  it('is offered, detected and rendered without any screen changes', () => {
    expect(registry.options().map((option) => option.code)).toEqual(['en', 'vi', 'xx']);
    expect(resolveLocale({ member: true, saved: 'xx', detected: [] }, registry)).toMatchObject({ locale: 'xx', source: 'saved' });
    expect(resolveLocale({ member: false, detected: ['xx-YY'] }, registry).locale).toBe('xx');
    const catalogs = { ...resources, xx: { ...resources.en, common: { language: { label: 'Lingo' } } } } as unknown as Record<'en' | 'vi' | 'xx', LocaleResources>;
    const instance = createI18n({ registry, catalogs, locale: 'xx' });
    expect(translateMessage(instance, { key: 'common:language.label' })).toBe('Lingo');
    // Missing in the new language → English fallback.
    expect(translateMessage(instance, { key: 'common:actions.save' })).toBe('Save');
  });
});

describe('locale-aware formatting', () => {
  it('never shifts calendar dates, in any language', () => {
    expect(formatCalendarDate('2026-11-01', 'en', 'medium')).toBe('Nov 1, 2026');
    expect(formatCalendarDate('2026-11-01', 'vi', 'medium')).toContain('2026');
    expect(formatCalendarDate('2026-11-01', 'vi', 'medium')).toMatch(/\b1\b/);
    expect(formatCalendarDate('not-a-date', 'en')).toBe('not-a-date');
  });

  it('keeps the organization timezone near midnight and across DST changes', () => {
    // 2026-11-01 06:30Z is 01:30 EDT, before the 02:00 fall-back in New York.
    const beforeFallBack = '2026-11-01T05:30:00Z';
    const afterFallBack = '2026-11-01T06:30:00Z';
    expect(formatInstantTime(beforeFallBack, 'en', { timeZone: 'America/New_York' })).toBe('1:30 AM');
    expect(formatInstantTime(afterFallBack, 'en', { timeZone: 'America/New_York' })).toBe('1:30 AM');
    expect(formatInstantTime(afterFallBack, 'vi', { timeZone: 'America/New_York' })).toMatch(/01:30|1:30/);
    // 23:30 in Ho Chi Minh City is still the 31st there, whatever the language.
    const lateEvening = '2026-10-31T16:30:00Z';
    expect(formatInstantDate(lateEvening, 'en', 'dayMonth', { timeZone: 'Asia/Ho_Chi_Minh' })).toBe('Oct 31');
    expect(formatInstantDate(lateEvening, 'vi', 'medium', { timeZone: 'Asia/Ho_Chi_Minh' })).toMatch(/31/);
    expect(formatInstantDateTime(lateEvening, 'en', { timeZone: 'Asia/Ho_Chi_Minh' })).toBe('Sat, Oct 31 · 11:30 PM');
  });

  it('keeps Sunday as the first weekday in both languages', () => {
    expect(weekdayNames('en')[0]).toBe('Sun');
    expect(weekdayNames('vi')[0]).toMatch(/CN|Chủ Nhật/i);
  });
});

describe('presentError', () => {
  it('maps stable API codes to catalog messages in every language', () => {
    expect(presentError(new ApiError(409, 'no link', 'PERSON_LINK_REQUIRED'), 'vi')).toEqual({ kind: 'message', message: { key: 'errors:codes.PERSON_LINK_REQUIRED' } });
  });

  it('never exposes server/database text for 5xx, and localizes unmapped 4xx outside English', () => {
    expect(presentError(new ApiError(500, 'relation "x" does not exist', 'XX000'), 'en')).toEqual({ kind: 'message', message: { key: 'errors:generic.server' } });
    expect(presentError(new ApiError(409, 'Restore this person first', 'conflict'), 'en')).toEqual({ kind: 'text', text: 'Restore this person first' });
    expect(presentError(new ApiError(409, 'Restore this person first', 'conflict'), 'vi')).toEqual({ kind: 'message', message: { key: 'errors:generic.conflict' } });
    expect(presentError(new TypeError('Failed to fetch'), 'vi')).toEqual({ kind: 'message', message: { key: 'errors:generic.network' } });
    expect(presentError(new Error('boom'), 'en')).toEqual({ kind: 'message', message: { key: 'errors:generic.unexpected' } });
  });
});
