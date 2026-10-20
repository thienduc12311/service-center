import type { ComponentType } from 'react';
import type { SupportedLocale } from '@service-center/shared';

/** Inline SVG flags: emoji flags don't render on Windows. */
interface FlagGraphicProps {
  className?: string;
}

const UnitedStatesFlag = ({ className }: FlagGraphicProps) => (
  <svg viewBox="0 0 38 20" className={className} aria-hidden="true" preserveAspectRatio="none">
    <rect width="38" height="20" fill="#fff" />
    {[0, 2, 4, 6, 8, 10, 12].map((row) => (
      <rect key={row} y={(row * 20) / 13} width="38" height={20 / 13} fill="#b22234" />
    ))}
    <rect width="15.2" height={(7 * 20) / 13} fill="#3c3b6e" />
    {[0, 1, 2, 3].map((row) =>
      [0, 1, 2, 3, 4].map((col) => (
        <circle key={`${row}-${col}`} cx={1.6 + col * 3 + (row % 2) * 1.5} cy={1.6 + row * 2.6} r="0.55" fill="#fff" />
      )),
    )}
  </svg>
);

const VietnamFlag = ({ className }: FlagGraphicProps) => (
  <svg viewBox="0 0 30 20" className={className} aria-hidden="true" preserveAspectRatio="none">
    <rect width="30" height="20" fill="#da251d" />
    <polygon points="15,4 16.76,9.43 22.47,9.43 17.85,12.79 19.61,18.21 15,14.86 10.39,18.21 12.15,12.79 7.53,9.43 13.24,9.43" fill="#ff0" />
  </svg>
);

/** Exhaustive: registering a language without a flag is a type error. */
const FLAGS: Record<SupportedLocale, ComponentType<FlagGraphicProps>> = {
  en: UnitedStatesFlag,
  vi: VietnamFlag,
};

export interface LocaleFlagProps {
  locale: SupportedLocale;
  className?: string;
}

export const LocaleFlag = ({ locale, className = '' }: LocaleFlagProps) => {
  const Flag = FLAGS[locale];
  return (
    <span className={`inline-block h-4 w-6 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10 ${className}`}>
      <Flag className="block size-full" />
    </span>
  );
};
