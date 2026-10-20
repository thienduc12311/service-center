import { useId, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { localeRegistry, type SupportedLocale } from '@service-center/shared';
import { useLanguage } from './LanguageProvider';

const AUTOMATIC = '';

const toChoice = (value: string): SupportedLocale | null =>
  value === AUTOMATIC ? null : localeRegistry.isSupported(value) ? value : null;

export interface LanguageSelectProps {
  /** Church name for the "saved for this church only" hint. */
  organizationName?: string | null;
  className?: string;
}

/**
 * "Language / Ngôn ngữ" for the signed-in member's own preference in the
 * active church, or the device choice when signed out. Options come from the
 * registry; nothing here knows which languages exist.
 */
export const LanguageSelect = ({ organizationName, className = '' }: LanguageSelectProps) => {
  const { t } = useTranslation();
  const id = useId();
  const { state, selected, member, automaticLocale, save, setAnonymousChoice } = useLanguage();
  const saving = state.pending !== undefined;
  const unsupported = typeof selected === 'string' && !localeRegistry.isSupported(selected) ? selected : null;
  const automaticLabel = t('language.automaticWithCurrent', { language: localeRegistry.definition(automaticLocale).nativeName });
  const linkMissing = member && state.personLinked === false;

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const choice = toChoice(event.target.value);
    if (member) void save(choice);
    else void setAnonymousChoice(choice);
  };

  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {t('language.bilingualLabel')}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          className="input max-w-xs"
          value={selected ?? AUTOMATIC}
          onChange={onChange}
          disabled={saving || linkMissing}
          aria-describedby={`${hintId} ${statusId}`}
          aria-busy={saving}
        >
          <option value={AUTOMATIC}>{automaticLabel}</option>
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
        {saving && <span className="text-sm text-slate-500">{t('language.saving')}</span>}
      </div>
      <p id={hintId} className="mt-1 text-xs text-slate-500">
        {member
          ? t('language.currentChurchHint', { organization: organizationName ?? t('fallback.yourChurch') })
          : t('language.anonymousHint')}{' '}
        {selected === null ? t('language.automaticHint') : null}
        {unsupported ? ` ${t('language.unsupportedSavedHint')}` : null}
      </p>
      <div id={statusId} aria-live="polite">
        {linkMissing && <p role="status" className="mt-2 text-sm text-amber-700">{t('language.linkRequired')}</p>}
        {state.error === 'save_failed' && (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {t('language.saveFailed')}
          </p>
        )}
        {state.error === 'offline' && (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {t('language.offline')}
          </p>
        )}
        {state.error === 'link_required' && !linkMissing && (
          <p role="alert" className="mt-2 text-sm text-amber-700">{t('language.linkRequired')}</p>
        )}
      </div>
    </div>
  );
};
