import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { translateMessage, type StructuredTextContext } from '@service-center/shared';
import { useLanguage } from './LanguageProvider';

/** The mobile adapter for the shared structured-text renderers (notices, problems, warnings). */
export const useStructuredText = (): StructuredTextContext => {
  const { i18n } = useTranslation();
  const { locale } = useLanguage();
  return useMemo<StructuredTextContext>(
    () => ({ locale, translate: (message) => translateMessage(i18n, message) }),
    [i18n, locale],
  );
};
