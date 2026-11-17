/* Landing page motion. Every pinned section exposes a 0..1 progress; scenes render from it,
   so scrolling scrubs the "film" like a video timeline, and Play just drives the scroll. */
(function () {
  document.documentElement.classList.remove('no-js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ramp = (v, a, b) => clamp((v - a) / (b - a));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Progress through a tall section while its sticky child is pinned. */
  const pinnedProgress = (el) => {
    const r = el.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    return span > 0 ? clamp(-r.top / span) : clamp(-r.top / r.height);
  };

  /* ------------------------------------------------------------- hero */
  const hero = $('[data-scene="hero"]');
  const renderHero = () => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty('--p', clamp(-r.top / r.height).toFixed(4));
  };

  /* ------------------------------------------------------------- film */
  const film = $('[data-scene="film"]');
  const phone = $('.phone', film);
  const captions = $$('[data-caption]', film);
  const screens = $$('[data-screen]', film);
  const chapterBtns = $$('[data-chapter]', film);
  const SCENES = 4;

  // Scene 0 parts
  const notif = $('[data-notif]', film);
  const request = $('[data-request]', film);
  const status = $('[data-status]', film);

  // Scene 1 parts
  const planItems = $$('[data-plan] li', film);
  const total = $('[data-total]', film);

  // Scene 2 parts: real transposition of the chart's chords.
  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const KEY_STEPS = [{ key: 'G', steps: 0 }, { key: 'A', steps: 2 }, { key: 'Bb', steps: 3, flats: true }, { key: 'C', steps: 5 }];
  const transpose = (chord, steps, flats) => chord.replace(/^([A-G][#b]?)/, (root) => {
    const idx = Math.max(SHARPS.indexOf(root), FLATS.indexOf(root));
    const name = (flats ? FLATS : SHARPS)[(idx + steps + 12) % 12];
    return name.replace('b', '♭').replace('#', '♯');
  });
  const chords = $$('[data-chart] c', film);
  const keyPills = $$('[data-keys] b', film);
  let currentKey = -1;
  const setKey = (i) => {
    if (i === currentKey) return;
    currentKey = i;
    const { steps, flats } = KEY_STEPS[i];
    keyPills.forEach((b, j) => b.classList.toggle('on', j === i));
    chords.forEach((c) => {
      c.setAttribute('data-show', transpose(c.getAttribute('data-c'), steps, flats));
      c.classList.remove('flip');
      void c.offsetWidth; // restart the flip animation
      c.classList.add('flip');
    });
  };
  setKey(0);

  // Scene 3 parts
  const LIVE = [{ t: 'Amazing Grace', d: 285 }, { t: 'Holy, Holy, Holy', d: 240 }, { t: 'Come Thou Fount', d: 300 }, { t: 'Sermon', d: 1800 }, { t: 'Be Thou My Vision', d: 260 }];
  const liveItems = $$('[data-live-list] li', film);
  const liveTitle = $('[data-live-title]', film);
  const liveBar = $('[data-live-bar]', film);
  const liveLeft = $('[data-live-left]', film);
  const liveClock = $('[data-clock]', film);
  const START = 10 * 3600 + 8 * 60; // 10:08:00

  let lastScene = -1;
  const renderFilm = () => {
    const r = film.getBoundingClientRect();
    phone.style.setProperty('--enter', easeOut(clamp(1 - r.top / window.innerHeight)).toFixed(4));
    const p = pinnedProgress(film);
    const scene = Math.min(SCENES - 1, Math.floor(p * SCENES));
    const l = clamp(p * SCENES - scene);

    if (scene !== lastScene) {
      lastScene = scene;
      film.dataset.sceneIndex = String(scene);
      captions.forEach((c, i) => c.classList.toggle('is-active', i === scene));
      screens.forEach((s, i) => s.classList.toggle('is-active', i === scene));
      chapterBtns.forEach((b, i) => b.classList.toggle('is-active', i === scene));
    }
    chapterBtns.forEach((b, i) => b.style.setProperty('--c', clamp(p * SCENES - i).toFixed(3)));

    if (scene === 0) {
      notif.style.setProperty('--n', (easeOut(ramp(l, 0.04, 0.18)) * (1 - ramp(l, 0.4, 0.5))).toFixed(3));
      request.style.setProperty('--hl', ramp(l, 0.4, 0.52).toFixed(3));
      request.style.setProperty('--press', ramp(l, 0.58, 0.72).toFixed(3));
      const done = ramp(l, 0.7, 0.8);
      request.style.setProperty('--done', done.toFixed(3));
      request.style.setProperty('--pop', easeBack(ramp(l, 0.72, 0.84)).toFixed(3));
      const confirmed = l > 0.7;
      status.textContent = confirmed ? 'Confirmed' : 'Pending';
      status.classList.toggle('ok', confirmed);
    } else if (scene === 1) {
      let seconds = 0;
      planItems.forEach((li, i) => {
        const shown = easeOut(ramp(l, 0.04 + i * 0.07, 0.12 + i * 0.07));
        li.style.setProperty('--in', shown.toFixed(3));
        seconds += Number(li.dataset.dur || 0) * shown;
      });
      total.textContent = mmss(seconds);
    } else if (scene === 2) {
      setKey(l < 0.3 ? 0 : l < 0.55 ? 1 : l < 0.8 ? 2 : 3);
    } else {
      const pos = clamp(l * 1.15, 0, 0.999) * LIVE.length;
      const cur = Math.floor(pos);
      const frac = pos - cur;
      liveItems.forEach((li, i) => {
        li.classList.toggle('done', i < cur);
        li.classList.toggle('now', i === cur);
        li.classList.toggle('next', i === cur + 1);
      });
      liveTitle.textContent = LIVE[cur].t;
      liveBar.style.width = `${(frac * 100).toFixed(1)}%`;
      liveLeft.textContent = `${mmss(LIVE[cur].d * (1 - frac))} left`;
      const elapsed = LIVE.slice(0, cur).reduce((s, x) => s + x.d, 0) + LIVE[cur].d * frac;
      const t = START + elapsed;
      liveClock.textContent = `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    }
  };

  /* ---------------------------------------------- film playback (drives scroll) */
  const FILM_SECONDS = 26;
  let playing = false;
  let rafId = 0;
  const filmTop = () => film.getBoundingClientRect().top + window.scrollY;
  const filmSpan = () => film.offsetHeight - window.innerHeight;

  const stop = () => {
    playing = false;
    film.classList.remove('is-playing');
    cancelAnimationFrame(rafId);
  };
  const play = () => {
    const top = filmTop();
    const span = filmSpan();
    let p = clamp((window.scrollY - top) / span);
    if (p >= 0.995) p = 0;
    playing = true;
    film.classList.add('is-playing');
    let last = performance.now();
    window.scrollTo(0, top + p * span);
    const tick = (now) => {
      if (!playing) return;
      p += (now - last) / 1000 / FILM_SECONDS;
      last = now;
      window.scrollTo(0, top + Math.min(p, 1) * span);
      if (p >= 1) return stop();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };
  const toggle = () => (playing ? stop() : play());

  $('[data-film-toggle]', film).addEventListener('click', toggle);
  $$('[data-play-film]').forEach((b) => b.addEventListener('click', play));
  chapterBtns.forEach((b) => b.addEventListener('click', () => {
    stop();
    const i = Number(b.dataset.chapter);
    window.scrollTo({ top: filmTop() + ((i + 0.02) / SCENES) * filmSpan(), behavior: reduceMotion ? 'auto' : 'smooth' });
  }));
  // Any manual scroll input hands control back to the viewer.
  ['wheel', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!playing) return;
    if (ev === 'keydown' && e.target.closest && e.target.closest('[data-film-toggle]')) return;
    stop();
  }, { passive: true }));

  /* -------------------------------------------------------- statement */
  const statement = $('[data-scene="statement"]');
  const textEl = $('[data-words]', statement);
  const words = textEl.textContent.trim().split(/\s+/);
  const accentFrom = words.indexOf('Now');
  textEl.innerHTML = words
    .map((w, i) => `<span class="w${i >= accentFrom && accentFrom >= 0 ? ' accent' : ''}">${w}</span>`)
    .join(' ');
  const wordEls = $$('.w', textEl);
  const renderStatement = () => {
    const p = pinnedProgress(statement);
    const lit = Math.round(ramp(p, 0.05, 0.8) * wordEls.length);
    wordEls.forEach((w, i) => w.classList.toggle('on', i < lit));
  };

  /* ----------------------------------------------------------- tablet */
  const tablet = $('[data-scene="tablet"]');
  const ipad = $('[data-ipad]', tablet);
  const sticky = $('.tablet-sticky', tablet);
  const shots = $$('[data-shot]', tablet);
  const shotLabels = $$('[data-shot-label]', tablet);
  const renderTablet = () => {
    const p = pinnedProgress(tablet);
    const zoomIn = easeOut(ramp(p, 0, 0.28));
    ipad.style.setProperty('--zoom', (1.75 - 0.75 * zoomIn).toFixed(4));
    sticky.style.setProperty('--head', ramp(p, 0.18, 0.3).toFixed(3));
    const idx = p < 0.3 ? 0 : Math.min(shots.length - 1, Math.floor(((p - 0.3) / 0.68) * shots.length));
    shots.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    shotLabels.forEach((s, i) => s.classList.toggle('is-active', i === idx));
  };

  /* ------------------------------------------------------------ loop */
  let queued = false;
  const render = () => {
    queued = false;
    renderHero();
    renderFilm();
    renderStatement();
    renderTablet();
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  render();

  /* ---------------------------------------------------- reveal on enter */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }
})();
