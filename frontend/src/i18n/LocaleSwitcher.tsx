import { useTranslation } from 'react-i18next';
import { localeRegistry, type SupportedLocale } from '@service-center/shared';
import { usePopupMenu } from '../hooks/usePopupMenu';
import { useLanguage } from './LanguageProvider';
import { LocaleFlag } from './LocaleFlag';

/**
 * Flag language switch. Signed in, it changes this tab only; signed out, it
 * sets the device choice. Neither touches the saved preference or the database.
 */
export const LocaleSwitcher = () => {
  const { t } = useTranslation();
  const { state, locale, member, setDisplayOverride, setAnonymousChoice } = useLanguage();
  const menu = usePopupMenu();

  const choose = (code: SupportedLocale) => {
    if (!member) void setAnonymousChoice(code);
    // Picking the language the preference resolves to drops the override.
    else setDisplayOverride(code === state.resolution.locale ? null : code);
    menu.close(true);
  };

  return (
    <div {...menu.rootProps} className="relative">
      <button
        type="button"
        ref={menu.triggerRef}
        id={menu.triggerId}
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.menuId : undefined}
        aria-label={`${t('language.toggleLabel')}: ${localeRegistry.definition(locale).nativeName}`}
        className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <LocaleFlag locale={locale} />
        <span>{locale.toUpperCase()}</span>
        <svg viewBox="0 0 10 6" className="size-2.5 text-slate-400" aria-hidden="true">
          <path d="M0 0h10L5 6z" fill="currentColor" />
        </svg>
      </button>

      {menu.open && (
        <div {...menu.menuProps} role="menu" className="card absolute right-0 z-50 mt-2 w-48 overflow-hidden py-1 text-sm">
          {localeRegistry.options().map((option) => {
            const active = option.code === locale;
            return (
              <button
                key={option.code}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={active}
                lang={option.lang}
                onClick={() => choose(option.code)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800 dark:hover:bg-slate-800 ${
                  active ? 'font-semibold text-brand-700 dark:text-brand-200' : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <LocaleFlag locale={option.code} />
                <span className="flex-1">{option.label}</span>
                {active && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
          {member && (
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-800">
              {t('language.displayOnlyHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
