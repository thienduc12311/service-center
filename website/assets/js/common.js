/* Shared by the landing page and the docs: wires links from config.js and the nav. */
(function () {
  const config = window.SITE_CONFIG || {};

  // Plain links: <a data-link="webAppUrl"> gets its href from config.js.
  document.querySelectorAll('[data-link]').forEach((el) => {
    const url = config[el.getAttribute('data-link')];
    if (url) el.setAttribute('href', url);
  });

  // Contact email: <a data-email> becomes a mailto: link showing the address.
  if (config.supportEmail) {
    document.querySelectorAll('[data-email]').forEach((el) => {
      el.setAttribute('href', `mailto:${config.supportEmail}`);
      if (el.hasAttribute('data-email-text')) el.textContent = config.supportEmail;
    });
  }

  // Store buttons (<a data-store="appStoreUrl|playStoreUrl">): live link once the
  // store URL is set in config.js, a non-clickable "Coming soon" badge until then.
  const STORE_LABELS = {
    appStoreUrl: { live: 'Download on the', soon: 'Coming soon to the' },
    playStoreUrl: { live: 'Get it on', soon: 'Coming soon on' },
  };
  document.querySelectorAll('[data-store]').forEach((el) => {
    const key = el.getAttribute('data-store');
    const labels = STORE_LABELS[key] || STORE_LABELS.appStoreUrl;
    const label = el.querySelector('[data-store-label]');
    const url = config[key];
    if (url) {
      el.setAttribute('href', url);
      el.removeAttribute('aria-disabled');
      el.classList.remove('is-soon');
      if (label) label.textContent = labels.live;
    } else {
      el.removeAttribute('href');
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('is-soon');
      if (label) label.textContent = labels.soon;
    }
  });

  // Nav: solid once scrolled; mobile menu toggle.
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const toggle = nav.querySelector('.nav-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      nav.querySelectorAll('.nav-links a').forEach((a) =>
        a.addEventListener('click', () => {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }),
      );
    }
  }

  // Appearance: automatic (follow the system) → light → dark. Saved per browser.
  const THEME_KEY = 'sc-theme';
  const THEME_ICONS = {
    auto: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    light: '<circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/>',
  };
  const THEME_LABELS = { auto: 'automatic', light: 'light', dark: 'dark' };
  const readTheme = () => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch (err) {
      return 'auto'; // storage blocked (private mode): fall back to the system setting
    }
  };
  const applyTheme = (mode) => {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const label = `Appearance: ${THEME_LABELS[mode]}`;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      const svg = btn.querySelector('svg');
      if (svg) svg.innerHTML = THEME_ICONS[mode];
    });
  };
  let theme = readTheme();
  applyTheme(theme);
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) =>
    btn.addEventListener('click', () => {
      theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
      applyTheme(theme);
      try {
        if (theme === 'auto') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, theme);
      } catch (err) {
        // Not saved (storage blocked); the choice still applies for this page view.
      }
    }),
  );

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
