import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { presentError, translateMessage } from '@service-center/shared';
import { useLanguage } from './LanguageProvider';

/** Localized, user-safe text for any thrown value (API error, network failure, …). */
export const useErrorText = (): ((error: unknown) => string) => {
  const { locale } = useLanguage();
  const { i18n } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const presentation = presentError(error, locale);
      return presentation.kind === 'text' ? presentation.text : translateMessage(i18n, presentation.message);
    },
    // `locale` changes whenever the displayed language does.
    [locale, i18n],
  );
};
