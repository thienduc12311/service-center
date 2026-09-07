import type { TextStyle } from 'react-native';

/**
 * Premium utilitarian minimalism: a warm monochrome canvas, hairline
 * structure, and colour reserved for semantic meaning. Every value a screen
 * needs is named here so no screen invents its own grey.
 */

export type ColorSchemeName = 'light' | 'dark';

export interface Palette {
  /** Page background. */
  canvas: string;
  /** Recessed strips (search bars, toolbars) that sit behind the canvas. */
  canvasSunken: string;
  /** Card and sheet fill. */
  surface: string;
  /** Inset wells inside a card: segmented controls, code blocks. */
  surfaceInset: string;
  /** The single hairline used for every card, divider and field. */
  border: string;
  /** Slightly firmer hairline for a focused or selected edge. */
  borderStrong: string;
  /** Body and heading text. Never pure black. */
  ink: string;
  /** Secondary text: timestamps, captions, supporting copy. */
  inkMuted: string;
  /** Tertiary text: placeholders, disabled glyphs, ordinals. */
  inkFaint: string;
  /** Inverted text, for use on `inkSolid`. */
  onInk: string;
  /** Solid near-black fill for the primary call to action. */
  inkSolid: string;
  /** Pressed state of `inkSolid`. */
  inkSolidPressed: string;
  /** Pressed state of a surface. */
  surfacePressed: string;
}

/** A washed-out pastel pair used for tags, status and icon wells. */
export interface Accent {
  bg: string;
  fg: string;
}

export interface AccentSet {
  red: Accent;
  blue: Accent;
  green: Accent;
  yellow: Accent;
  neutral: Accent;
}

export interface RadiusScale {
  /** Keycaps, inline code, tiny chips. */
  xs: number;
  /** Buttons and fields. */
  sm: number;
  /** Inset wells. */
  md: number;
  /** Cards. Nothing in the app is rounder than this except a true pill. */
  lg: number;
  /** Reserved for genuinely circular elements only (avatars, dots). */
  pill: number;
}

export interface SpaceScale {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  /** Between stacked cards. */
  xxl: number;
  /** Macro whitespace between major sections of a screen. */
  section: number;
  /** Screen-opening whitespace. */
  hero: number;
}

/**
 * Custom font families carry their weight in the family name, so these styles
 * deliberately never set `fontWeight` — doing so silently breaks the mapping
 * on Android.
 */
export interface TypeScale {
  /** Editorial serif, screen-opening. */
  display: TextStyle;
  /** Editorial serif, card-opening. */
  title: TextStyle;
  /** Sans, row and card headings. */
  heading: TextStyle;
  /** Sans, the default reading size. */
  body: TextStyle;
  /** Sans, supporting copy. */
  bodySmall: TextStyle;
  /** Mono, uppercase, wide tracking: section labels and metadata. */
  label: TextStyle;
  /** Mono, figures and keys that must align. */
  numeric: TextStyle;
  /** Mono, chord charts and source text. */
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

export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemiBold: 'Geist_600SemiBold',
  serif: 'InstrumentSerif_400Regular',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

const radius: RadiusScale = { xs: 4, sm: 6, md: 8, lg: 12, pill: 9999 };

const space: SpaceScale = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  section: 48,
  hero: 64,
};

const lightPalette: Palette = {
  canvas: '#FBFBFA',
  canvasSunken: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceInset: '#F7F6F3',
  border: '#EAEAEA',
  borderStrong: '#D8D7D3',
  ink: '#191918',
  inkMuted: '#787774',
  inkFaint: '#A5A39E',
  onInk: '#FFFFFF',
  inkSolid: '#191918',
  inkSolidPressed: '#3A3A37',
  surfacePressed: '#F2F1EE',
};

const darkPalette: Palette = {
  canvas: '#151513',
  canvasSunken: '#1B1B19',
  surface: '#1F1E1C',
  surfaceInset: '#262523',
  border: '#302F2C',
  borderStrong: '#403E3A',
  ink: '#F4F2EE',
  inkMuted: '#9B9A95',
  inkFaint: '#6E6C67',
  onInk: '#191918',
  inkSolid: '#F4F2EE',
  inkSolidPressed: '#CFCCC5',
  surfacePressed: '#262523',
};

const lightAccents: AccentSet = {
  red: { bg: '#FDEBEC', fg: '#9F2F2D' },
  blue: { bg: '#E1F3FE', fg: '#1F6C9F' },
  green: { bg: '#EDF3EC', fg: '#346538' },
  yellow: { bg: '#FBF3DB', fg: '#956400' },
  neutral: { bg: '#F1F0ED', fg: '#5F5E5A' },
};

const darkAccents: AccentSet = {
  red: { bg: '#3A2321', fg: '#E5A5A2' },
  blue: { bg: '#1C2E3A', fg: '#8EC6E8' },
  green: { bg: '#22301F', fg: '#9DC49C' },
  yellow: { bg: '#332A19', fg: '#DFBB6B' },
  neutral: { bg: '#2A2926', fg: '#A8A6A1' },
};

const type: TypeScale = {
  display: { fontFamily: fonts.serif, fontSize: 36, lineHeight: 40, letterSpacing: -0.9 },
  title: { fontFamily: fonts.serif, fontSize: 27, lineHeight: 31, letterSpacing: -0.6 },
  heading: { fontFamily: fonts.sansSemiBold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 24 },
  bodySmall: { fontFamily: fonts.sans, fontSize: 13.5, lineHeight: 20 },
  label: { fontFamily: fonts.monoMedium, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.9 },
  numeric: { fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18 },
  code: { fontFamily: fonts.mono, fontSize: 13.5, lineHeight: 20 },
};

export const lightTheme: Theme = {
  scheme: 'light',
  color: lightPalette,
  accent: lightAccents,
  radius,
  space,
  type,
};

export const darkTheme: Theme = {
  scheme: 'dark',
  color: darkPalette,
  accent: darkAccents,
  radius,
  space,
  type,
};

export const themes: Record<ColorSchemeName, Theme> = { light: lightTheme, dark: darkTheme };

export type AssignmentStatus = 'confirmed' | 'declined' | 'unconfirmed';

/** Status is the one place colour carries meaning rather than decoration. */
export const statusAccent = (theme: Theme, status: AssignmentStatus): Accent =>
  ({
    confirmed: theme.accent.green,
    declined: theme.accent.red,
    unconfirmed: theme.accent.yellow,
  })[status];
