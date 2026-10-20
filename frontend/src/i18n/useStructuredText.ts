import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { translateMessage, type StructuredTextContext } from '@service-center/shared';
import { useLanguage } from './LanguageProvider';

/** Context for the shared renderers that word server notices and warnings from their codes. */
export const useStructuredText = (): StructuredTextContext => {
  const { i18n } = useTranslation();
  const { locale } = useLanguage();
  return useMemo(() => ({ locale, translate: (message) => translateMessage(i18n, message) }), [i18n, locale]);
};
