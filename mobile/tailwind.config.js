/**
 * NativeWind is kept for its colour-scheme store (`useColorScheme`), which the
 * theme in `src/lib/theme.ts` reads. Components style themselves from that
 * theme rather than from utility classes, so this config only mirrors the
 * tokens for anything that still reaches for a class.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: { DEFAULT: '#FBFBFA', sunken: '#F7F6F3', dark: '#151513' },
        surface: { DEFAULT: '#FFFFFF', inset: '#F7F6F3', dark: '#1F1E1C' },
        hairline: { DEFAULT: '#EAEAEA', strong: '#D8D7D3', dark: '#302F2C' },
        ink: { DEFAULT: '#191918', muted: '#787774', faint: '#A5A39E', inverse: '#F4F2EE' },
      },
      fontFamily: {
        sans: ['Geist_400Regular'],
        serif: ['InstrumentSerif_400Regular'],
        mono: ['GeistMono_400Regular'],
      },
      borderRadius: { card: '12px' },
    },
  },
  plugins: [],
};
