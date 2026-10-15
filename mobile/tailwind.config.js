/**
 * NativeWind supplies appearance state. Product components use the shared
 * tokens through src/lib/theme.ts, avoiding a second independent palette.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
