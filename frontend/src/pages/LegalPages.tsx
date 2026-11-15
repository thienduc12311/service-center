import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { env } from '../lib/env';
import { LocaleSwitcher, useFormatters } from '../i18n';
import { Icon } from '../components/icons';

/** When the privacy policy last changed (shown as "Last updated"). Bump it with every policy edit. */
const PRIVACY_POLICY_UPDATED = '2026-11-15';

interface LegalLayoutProps {
  /** Becomes the browser tab title too. */
  title: string;
  children: ReactNode;
}

/**
 * Public, sign-in-free frame for the Privacy Policy and Support pages: the
 * App Store links to them, so they must load for anyone.
 */
const LegalLayout = ({ title, children }: LegalLayoutProps) => {
  const { t } = useTranslation(['legal', 'common']);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · ${t('common:app.name')}`;
    return () => {
      document.title = previous;
    };
  }, [title, t]);

  return (
    <div className="min-h-screen bg-app-canvas">
      <header className="border-b border-app-border bg-app-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-700 text-xs font-bold text-white shadow-sm shadow-brand-600/30">
              SC
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{t('common:app.name')}</span>
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        <div className="mt-6 space-y-8 text-[15px] leading-relaxed text-pretty text-slate-700 dark:text-slate-300">{children}</div>
      </main>
      <footer className="border-t border-app-border">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
          <Link className="hover:text-slate-900 hover:underline dark:hover:text-white" to="/privacy">{t('nav.privacy')}</Link>
          <Link className="hover:text-slate-900 hover:underline dark:hover:text-white" to="/support">{t('nav.support')}</Link>
          <Link className="hover:text-slate-900 hover:underline dark:hover:text-white" to="/">{t('nav.openApp')}</Link>
        </nav>
      </footer>
    </div>
  );
};

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

const LegalSection = ({ title, children }: LegalSectionProps) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
    {children}
  </section>
);

const SupportEmail = () => (
  <a className="font-medium text-brand-700 hover:underline dark:text-brand-200" href={`mailto:${env.supportEmail}`}>
    {env.supportEmail}
  </a>
);

/** Text with an `{{email}}` placeholder, rendered with the address as a mail link. */
const WithEmail = ({ text }: { text: string }) => {
  const [before, after] = text.split(env.supportEmail);
  return (
    <>
      {before}
      <SupportEmail />
      {after}
    </>
  );
};

/** `/privacy`: the Privacy Policy URL given to the App Store. */
export const PrivacyPolicyPage = () => {
  const { t } = useTranslation('legal');
  const format = useFormatters();
  const email = env.supportEmail;
  return (
    <LegalLayout title={t('privacy.title')}>
      <p className="-mt-4 text-sm text-slate-500 dark:text-slate-400">
        {t('nav.lastUpdated', { date: format.calendarDate(PRIVACY_POLICY_UPDATED, 'long') })}
      </p>
      <p>{t('privacy.intro')}</p>

      <LegalSection title={t('privacy.collect.title')}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('privacy.collect.account')}</li>
          <li>{t('privacy.collect.organization')}</li>
          <li>{t('privacy.collect.content')}</li>
          <li>{t('privacy.collect.device')}</li>
          <li>{t('privacy.collect.technical')}</li>
        </ul>
      </LegalSection>

      <LegalSection title={t('privacy.use.title')}>
        <p>{t('privacy.use.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.sharing.title')}>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('privacy.sharing.organization')}</li>
          <li>{t('privacy.sharing.providers')}</li>
          <li>{t('privacy.sharing.integrations')}</li>
          <li>{t('privacy.sharing.legal')}</li>
        </ul>
      </LegalSection>

      <LegalSection title={t('privacy.safety.title')}>
        <p>{t('privacy.safety.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.retention.title')}>
        <p>{t('privacy.retention.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.security.title')}>
        <p>{t('privacy.security.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.children.title')}>
        <p>{t('privacy.children.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.rights.title')}>
        <p>{t('privacy.rights.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.changes.title')}>
        <p>{t('privacy.changes.body')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.contact.title')}>
        <p><WithEmail text={t('privacy.contact.body', { email })} /></p>
      </LegalSection>
    </LegalLayout>
  );
};

/** The support questions, in display order. */
const FAQ_TOPICS = ['join', 'password', 'schedule', 'notifications', 'report', 'delete'] as const;

/** `/support`: the Support URL given to the App Store. */
export const SupportPage = () => {
  const { t } = useTranslation('legal');
  const email = env.supportEmail;
  return (
    <LegalLayout title={t('support.title')}>
      <p>{t('support.intro')}</p>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('support.contactTitle')}</h2>
        <p><WithEmail text={t('support.contactBody', { email })} /></p>
        <a
          href={`mailto:${email}`}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          <Icon name="mail" className="size-4" />
          {t('support.emailButton')}
        </a>
      </section>

      <LegalSection title={t('support.faqTitle')}>
        <div className="space-y-5">
          {FAQ_TOPICS.map((topic) => (
            <div key={topic}>
              <h3 className="font-medium text-slate-900 dark:text-white">{t(`support.faq.${topic}Q`)}</h3>
              <p className="mt-1">{t(`support.faq.${topic}A`)}</p>
            </div>
          ))}
        </div>
      </LegalSection>

      <p>
        <Link className="font-medium text-brand-700 hover:underline dark:text-brand-200" to="/privacy">{t('support.privacyLink')}</Link>
      </p>
    </LegalLayout>
  );
};
