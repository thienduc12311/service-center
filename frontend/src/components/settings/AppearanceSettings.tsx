import { useTranslation } from 'react-i18next';
import { APPEARANCE_MODES } from '@service-center/shared';
import { useTheme } from '../../providers/ThemeProvider';

/**
 * Light/dark/system for this browser (MOB-021 parity with the phone). The
 * header button only flips light/dark; this is where "System" is chosen again.
 */
export const AppearanceSettings = () => {
  const { t } = useTranslation('settings');
  const { mode, setMode } = useTheme();

  return (
    <section className="card p-5" aria-labelledby="appearance-settings-heading">
      <h2 id="appearance-settings-heading" className="mb-1 font-semibold">{t('profile.appearance.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('profile.appearance.description')}</p>
      <div role="radiogroup" aria-labelledby="appearance-settings-heading" className="flex flex-wrap gap-2">
        {APPEARANCE_MODES.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
              mode === option
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <input
              type="radio"
              name="appearance"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            {t(`profile.appearance.${option}`)}
          </label>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">
        {mode === 'system' ? `${t('profile.appearance.systemHint')} ` : ''}
        {t('profile.appearance.deviceOnly')}
      </p>
    </section>
  );
};
