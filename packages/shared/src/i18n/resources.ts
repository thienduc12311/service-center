/**
 * Explicit catalog imports for every runtime. Static JSON imports (with the
 * standard `type: 'json'` attribute) are compiled into `dist/` by tsc, read
 * natively by Node, and bundled by Vite and Metro — no runtime file loading,
 * no bundler-specific glob.
 *
 * Adding a namespace: create `locales/<code>/<namespace>.json` for every
 * language, import it below, and add it to `NAMESPACES`.
 */

import enAuth from './locales/en/auth.json' with { type: 'json' };
import enCommon from './locales/en/common.json' with { type: 'json' };
import enErrors from './locales/en/errors.json' with { type: 'json' };
import enMedia from './locales/en/media.json' with { type: 'json' };
import enMessages from './locales/en/messages.json' with { type: 'json' };
import enNotifications from './locales/en/notifications.json' with { type: 'json' };
import enPeople from './locales/en/people.json' with { type: 'json' };
import enPlans from './locales/en/plans.json' with { type: 'json' };
import enReports from './locales/en/reports.json' with { type: 'json' };
import enScheduling from './locales/en/scheduling.json' with { type: 'json' };
import enSettings from './locales/en/settings.json' with { type: 'json' };
import enSongs from './locales/en/songs.json' with { type: 'json' };
import enTeams from './locales/en/teams.json' with { type: 'json' };
import enHome from './locales/en/home.json' with { type: 'json' };
import enStaffing from './locales/en/staffing.json' with { type: 'json' };
import enTemplates from './locales/en/templates.json' with { type: 'json' };

import viAuth from './locales/vi/auth.json' with { type: 'json' };
import viCommon from './locales/vi/common.json' with { type: 'json' };
import viErrors from './locales/vi/errors.json' with { type: 'json' };
import viMedia from './locales/vi/media.json' with { type: 'json' };
import viMessages from './locales/vi/messages.json' with { type: 'json' };
import viNotifications from './locales/vi/notifications.json' with { type: 'json' };
import viPeople from './locales/vi/people.json' with { type: 'json' };
import viPlans from './locales/vi/plans.json' with { type: 'json' };
import viReports from './locales/vi/reports.json' with { type: 'json' };
import viScheduling from './locales/vi/scheduling.json' with { type: 'json' };
import viSettings from './locales/vi/settings.json' with { type: 'json' };
import viSongs from './locales/vi/songs.json' with { type: 'json' };
import viTeams from './locales/vi/teams.json' with { type: 'json' };
import viHome from './locales/vi/home.json' with { type: 'json' };
import viStaffing from './locales/vi/staffing.json' with { type: 'json' };
import viTemplates from './locales/vi/templates.json' with { type: 'json' };

import type { SupportedLocale } from './locales.js';

/** Feature namespaces. English defines the key contract for each. */
export const NAMESPACES = [
  'common',
  'home',
  'auth',
  'errors',
  'settings',
  'people',
  'plans',
  'templates',
  'staffing',
  'scheduling',
  'songs',
  'teams',
  'messages',
  'media',
  'reports',
  'notifications',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE = 'common' satisfies Namespace;

/** The English catalogs, whose shape is the typed key contract. */
export const englishResources = {
  common: enCommon,
  home: enHome,
  auth: enAuth,
  errors: enErrors,
  settings: enSettings,
  people: enPeople,
  plans: enPlans,
  templates: enTemplates,
  staffing: enStaffing,
  scheduling: enScheduling,
  songs: enSongs,
  teams: enTeams,
  messages: enMessages,
  media: enMedia,
  reports: enReports,
  notifications: enNotifications,
};

export type EnglishResources = typeof englishResources;

/** A translation catalog tree: nested objects whose leaves are strings. */
export interface CatalogTree {
  [key: string]: string | CatalogTree;
}

export type LocaleResources = Record<Namespace, CatalogTree>;

/**
 * Every language's catalogs. Other languages may legitimately use different
 * plural suffixes than English (Vietnamese has only `_other`), so they are
 * checked by `validateCatalogs` rather than by the English type.
 */
export const resources: Record<SupportedLocale, LocaleResources> = {
  en: englishResources,
  vi: {
    common: viCommon,
    home: viHome,
    auth: viAuth,
    errors: viErrors,
    settings: viSettings,
    people: viPeople,
    plans: viPlans,
    templates: viTemplates,
    staffing: viStaffing,
    scheduling: viScheduling,
    songs: viSongs,
    teams: viTeams,
    messages: viMessages,
    media: viMedia,
    reports: viReports,
    notifications: viNotifications,
  },
};
