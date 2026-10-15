import { Platform, type TextStyle } from 'react-native';
import {
  ASSIGNMENT_STATUS_ACCENTS,
  serviceCenterDesignTokens,
  type AssignmentStatus,
  type ServiceCenterAccent,
  type ServiceCenterAccents,
  type ServiceCenterPalette,
} from '@service-center/shared';

/** Native typography and layout, using the website's shared product tokens. */
export type ColorSchemeName = 'light' | 'dark';
export type Palette = ServiceCenterPalette;
export type Accent = ServiceCenterAccent;
export type AccentSet = ServiceCenterAccents;

export interface RadiusScale {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  pill: number;
}

export interface SpaceScale {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  section: number;
  hero: number;
}

export interface TypeScale {
  display: TextStyle;
  title: TextStyle;
  heading: TextStyle;
  body: TextStyle;
  bodySmall: TextStyle;
  label: TextStyle;
  numeric: TextStyle;
  code: TextStyle;
}

export interface Theme {
  scheme: ColorSchemeName;
  color: Palette;
  accent: AccentSet;
  radius: RadiusScale;
  space: SpaceScale;
  type: TypeScale;
}

const sans = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' });
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export const fonts = { sans, sansMedium: sans, sansSemiBold: sans, mono, monoMedium: mono } as const;

const radius: RadiusScale = {
  xs: serviceCenterDesignTokens.radius.small,
  sm: serviceCenterDesignTokens.radius.control,
  md: serviceCenterDesignTokens.radius.input,
  lg: serviceCenterDesignTokens.radius.card,
  pill: 9999,
};

const space: SpaceScale = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 24, section: 32, hero: 32,
};

const type: TypeScale = {
  display: { fontFamily: sans, fontWeight: '600', fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  title: { fontFamily: sans, fontWeight: '600', fontSize: 20, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: sans, fontWeight: '600', fontSize: 16, lineHeight: 22 },
  body: { fontFamily: sans, fontSize: 15, lineHeight: 22 },
  bodySmall: { fontFamily: sans, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: sans, fontWeight: '500', fontSize: 13, lineHeight: 18 },
  numeric: { fontFamily: sans, fontVariant: ['tabular-nums'], fontSize: 13, lineHeight: 18 },
  code: { fontFamily: mono, fontSize: 13.5, lineHeight: 20 },
};

export const lightTheme: Theme = {
  scheme: 'light', ...serviceCenterDesignTokens.schemes.light, radius, space, type,
};

export const darkTheme: Theme = {
  scheme: 'dark', ...serviceCenterDesignTokens.schemes.dark, radius, space, type,
};

export const themes: Record<ColorSchemeName, Theme> = { light: lightTheme, dark: darkTheme };

export const statusAccent = (theme: Theme, status: AssignmentStatus): Accent =>
  theme.accent[ASSIGNMENT_STATUS_ACCENTS[status]];
