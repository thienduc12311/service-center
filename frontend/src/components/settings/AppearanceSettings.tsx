import { useTranslation } from 'react-i18next';
import { APPEARANCE_MODES, type AppearanceMode } from '@service-center/shared';
import { useTheme } from '../../providers/ThemeProvider';
import { Icon, type IconName } from '../icons';

/** The glyph shown beside each appearance option. */
const APPEARANCE_ICONS: Readonly<Record<AppearanceMode, IconName>> = { light: 'sun', dark: 'moon', system: 'settings' };

/**
 * Light/dark/system for this browser (MOB-021 parity with the phone). The
 * header button only flips light/dark; this is where "System" is chosen again.
 */
export const AppearanceSettings = () => {
  const { t } = useTranslation('settings');
  const { mode, setMode } = useTheme();

  return (
    <section className="card p-5" aria-labelledby="appearance-settings-heading">
      <h2 id="appearance-settings-heading" className="mb-1 font-semibold text-slate-900 dark:text-white">{t('profile.appearance.title')}</h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('profile.appearance.description')}</p>
      <div role="radiogroup" aria-labelledby="appearance-settings-heading" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {APPEARANCE_MODES.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 ${
              mode === option
                ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500 dark:bg-brand-500/15 dark:text-brand-200'
                : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60'
            }`}
          >
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
              className="sr-only"
            />
            <span
              className={`grid size-8 place-items-center rounded-lg ${
                mode === option ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Icon name={APPEARANCE_ICONS[option]} className="size-4" />
            </span>
            <span className="flex-1">{t(`profile.appearance.${option}`)}</span>
            {mode === option && <Icon name="check" className="size-4" />}
          </label>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {mode === 'system' ? `${t('profile.appearance.systemHint')} ` : ''}
        {t('profile.appearance.deviceOnly')}
      </p>
    </section>
  );
};
