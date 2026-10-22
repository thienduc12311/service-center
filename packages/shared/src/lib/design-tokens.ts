import type { AssignmentStatus, PlanStatus } from '../types/database.js';
import type { NoteAudience } from '../types/collaboration.js';
import type { AttendanceStatus } from '../types/reports.js';

/** Product colors and component dimensions shared by the website and native app. */
export interface ServiceCenterPalette {
  canvas: string;
  canvasSunken: string;
  surface: string;
  surfaceInset: string;
  field: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  onBrand: string;
  brand: string;
  brandPressed: string;
  brandText: string;
  danger: string;
  dangerPressed: string;
  surfacePressed: string;
}

export interface ServiceCenterAccent {
  bg: string;
  fg: string;
}

export interface ServiceCenterAccents {
  red: ServiceCenterAccent;
  blue: ServiceCenterAccent;
  green: ServiceCenterAccent;
  yellow: ServiceCenterAccent;
  neutral: ServiceCenterAccent;
}

export type ServiceCenterAccentName = keyof ServiceCenterAccents;

export interface ServiceCenterColorScheme {
  color: ServiceCenterPalette;
  accent: ServiceCenterAccents;
}

export type BrandShade = 50 | 100 | 200 | 400 | 500 | 600 | 700;

export interface ServiceCenterDesignTokens {
  brand: Record<BrandShade, string>;
  schemes: Record<'light' | 'dark', ServiceCenterColorScheme>;
  radius: { small: number; control: number; input: number; card: number };
}

export const serviceCenterDesignTokens: ServiceCenterDesignTokens = {
  brand: {
    50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 400: '#818cf8',
    500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
  },
  schemes: {
    light: {
      color: {
        canvas: '#f8fafc', canvasSunken: '#f1f5f9', surface: '#ffffff',
        surfaceInset: '#f1f5f9', field: '#ffffff', border: '#e2e8f0',
        borderStrong: '#cbd5e1', ink: '#0f172a', inkMuted: '#475569',
        inkFaint: '#64748b', onBrand: '#ffffff', brand: '#4f46e5',
        brandPressed: '#4338ca', brandText: '#4338ca', danger: '#e11d48',
        dangerPressed: '#be123c', surfacePressed: '#f1f5f9',
      },
      accent: {
        red: { bg: '#fff1f2', fg: '#be123c' },
        blue: { bg: '#eef2ff', fg: '#4338ca' },
        green: { bg: '#ecfdf5', fg: '#047857' },
        yellow: { bg: '#fffbeb', fg: '#b45309' },
        neutral: { bg: '#f1f5f9', fg: '#475569' },
      },
    },
    dark: {
      color: {
        canvas: '#020617', canvasSunken: '#0f172a', surface: '#0f172a',
        surfaceInset: '#1e293b', field: '#020617', border: '#1e293b',
        borderStrong: '#334155', ink: '#f1f5f9', inkMuted: '#cbd5e1',
        inkFaint: '#94a3b8', onBrand: '#ffffff', brand: '#4f46e5',
        brandPressed: '#4338ca', brandText: '#a5b4fc', danger: '#e11d48',
        dangerPressed: '#be123c', surfacePressed: '#1e293b',
      },
      accent: {
        red: { bg: '#4c0519', fg: '#fda4af' },
        blue: { bg: '#1e1b4b', fg: '#a5b4fc' },
        green: { bg: '#022c22', fg: '#6ee7b7' },
        yellow: { bg: '#451a03', fg: '#fcd34d' },
        neutral: { bg: '#1e293b', fg: '#cbd5e1' },
      },
    },
  },
  radius: { small: 4, control: 8, input: 12, card: 16 },
};

/**
 * MOB-012: the accent each plan status uses on native, matching the website's
 * badges (published in the brand colour, draft and archived neutral). Always
 * render it with the status label.
 */
export const PLAN_STATUS_ACCENTS: Record<PlanStatus, ServiceCenterAccentName> = {
  draft: 'neutral',
  published: 'blue',
  archived: 'neutral',
};

/**
 * The semantic accent each assignment status uses on both clients. Color only
 * reinforces the status: always render it with ASSIGNMENT_STATUS_LABELS.
 */
export const ASSIGNMENT_STATUS_ACCENTS: Record<AssignmentStatus, ServiceCenterAccentName> = {
  confirmed: 'green',
  declined: 'red',
  unconfirmed: 'yellow',
};

/**
 * MOB-017: the accent each F16 attendance status uses on native, matching the
 * website's attendance badges. Always render it with the status label.
 */
export const ATTENDANCE_STATUS_ACCENTS: Record<AttendanceStatus, ServiceCenterAccentName> = {
  present: 'green',
  absent: 'red',
  unknown: 'neutral',
};

/**
 * MOB-016: the accent each F09 note audience uses on native, matching the
 * website's audience badges. Always render it with the audience label.
 */
export const NOTE_AUDIENCE_ACCENTS: Record<NoteAudience, ServiceCenterAccentName> = {
  organization: 'neutral',
  scheduled: 'blue',
  teams: 'green',
  leaders: 'yellow',
};
