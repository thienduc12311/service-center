import { useTranslation } from 'react-i18next';
import { localeRegistry, type PreferredLanguage } from '@service-center/shared';

export interface PersonLanguageFieldProps {
  id: string;
  /** '' = Automatic, a code, or a code this client does not know (kept as is). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The manager's "Language / Ngôn ngữ" field on Person create/edit forms.
 * Saved with the rest of the form through the people.manage update; it can be
 * set before the Person has a login.
 */
export const PersonLanguageField = ({ id, value, onChange, disabled }: PersonLanguageFieldProps) => {
  const { t } = useTranslation();
  const unsupported = value !== '' && !localeRegistry.isSupported(value) ? value : null;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {t('language.bilingualLabel')}
      </label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-describedby={`${id}-hint`}>
        <option value="">{t('language.automatic')}</option>
        {localeRegistry.options().map((option) => (
          <option key={option.code} value={option.code} lang={option.lang}>
            {option.label}
          </option>
        ))}
        {unsupported && (
          <option value={unsupported} disabled>
            {t('language.unsupportedSaved', { code: unsupported })}
          </option>
        )}
      </select>
      <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
        {t('language.automaticHint')}
      </p>
    </div>
  );
};

/**
 * Form value → API field. A code this client does not support is left out
 * of the request so the saved value is preserved; '' clears to Automatic.
 */
export const personLanguageInput = (value: string): { preferred_language?: PreferredLanguage } =>
  value === '' ? { preferred_language: null } : localeRegistry.isSupported(value) ? { preferred_language: value } : {};
