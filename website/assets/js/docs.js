/* Docs page: sidebar scroll-spy, instant topic search, and the small-screen topic menu. */
(function () {
  const sections = Array.from(document.querySelectorAll('.doc-section'));
  const links = Array.from(document.querySelectorAll('.docs-sidebar a[href^="#"]'));
  const linkFor = (id) => links.find((a) => a.getAttribute('href') === `#${id}`);
  const menuBtn = document.querySelector('[data-docs-menu]');
  const menuLabel = document.querySelector('[data-docs-menu-label]');
  const sidebar = document.querySelector('.docs-sidebar');

  /* ---------------------------------------------------- scroll-spy */
  const setActive = (id) => {
    links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}`));
    const link = linkFor(id);
    if (link && menuLabel) menuLabel.textContent = link.textContent;
  };
  const spy = () => {
    const line = window.innerHeight * 0.25;
    let current = sections[0];
    for (const s of sections) {
      if (s.classList.contains('is-hidden')) continue;
      if (s.getBoundingClientRect().top - line <= 0) current = s;
    }
    if (current) setActive(current.id);
  };
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; spy(); });
  }, { passive: true });
  spy();

  /* -------------------------------------------- small-screen menu */
  const closeMenu = () => {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      const open = sidebar.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    links.forEach((a) => a.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  }

  /* --------------------------------------------------------- search */
  const input = document.querySelector('[data-docs-search]');
  const empty = document.querySelector('[data-search-empty]');
  if (!input) return;

  // Keep each section's text once, so highlighting can be undone cleanly.
  const originals = new Map(sections.map((s) => [s, s.innerHTML]));
  const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlight = (root, re) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement.closest('summary, script') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (!re.test(node.nodeValue)) return;
      re.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = node.nodeValue
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(re, (m) => `<mark>${m}</mark>`);
      node.replaceWith(...span.childNodes);
    });
  };

  const run = () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    sections.forEach((s) => {
      s.innerHTML = originals.get(s);
      const match = !q || s.textContent.toLowerCase().includes(q);
      s.classList.toggle('is-hidden', !match);
      const li = linkFor(s.id) && linkFor(s.id).parentElement;
      if (li) li.classList.toggle('is-hidden', !match);
      if (match) shown += 1;
      if (match && q.length > 1) {
        highlight(s, new RegExp(escapeRe(q), 'gi'));
        s.querySelectorAll('details').forEach((d) => { if (d.querySelector('mark')) d.open = true; });
      }
    });
    // Hide a sidebar group heading when none of its topics match.
    document.querySelectorAll('.docs-sidebar h2').forEach((h) => {
      const list = h.nextElementSibling;
      const any = list && list.querySelector('li:not(.is-hidden)');
      h.style.display = any ? '' : 'none';
    });
    if (empty) empty.classList.toggle('is-shown', shown === 0);
    spy();
  };

  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = sections.find((s) => !s.classList.contains('is-hidden'));
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (e.key === 'Escape') { input.value = ''; run(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      input.focus();
    }
  });
})();
