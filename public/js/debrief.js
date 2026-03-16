/* ============================================
   debrief.js — Slide Engine, Socket Sync, Edit Mode
   "My Year: A Debrief" by Kaliph
   ============================================ */

(function () {
  'use strict';

  // --- State ---
  let role = null;           // 'presenter' | 'viewer' | 'editor'
  let slideIndex = 0;
  let revealStep = 0;
  let totalSlides = 19;
  let presenterConnected = false;
  let audioMuted = false;
  let config = {};
  let contentData = {};
  let months = [];           // merged month data
  let debriefData = {};      // merged debrief data

  const socket = io();

  // --- DOM refs ---
  const gateScreen = document.getElementById('gate-screen');
  const gateForm = document.getElementById('gate-form');
  const gatePassword = document.getElementById('gate-password');
  const gateError = document.getElementById('gate-error');
  const gateAudio = document.getElementById('gate-audio');
  const slideAudio = document.getElementById('slide-audio');
  const audioToggle = document.getElementById('audio-toggle');
  const audioIconOn = document.getElementById('audio-icon-on');
  const audioIconOff = document.getElementById('audio-icon-off');
  const audioPrompt = document.getElementById('audio-prompt');
  const presentation = document.getElementById('presentation');
  const roleBadge = document.getElementById('role-badge');
  const waitingScreen = document.getElementById('waiting-screen');
  const slidesContainer = document.getElementById('slides-container');
  const dotNav = document.getElementById('dot-nav');
  const slideCounter = document.getElementById('slide-counter');
  const revealCounter = document.getElementById('reveal-counter');
  const presenterControls = document.getElementById('presenter-controls');
  const editToolbar = document.getElementById('edit-toolbar');
  const settingsDrawer = document.getElementById('settings-drawer');

  // --- Vinyl helper ---
  function createVinyl() {
    const tpl = document.getElementById('vinyl-template');
    return tpl.content.cloneNode(true).querySelector('svg');
  }

  function injectVinyls() {
    const ids = ['gate-vinyl', 'waiting-vinyl'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.querySelector('svg')) el.appendChild(createVinyl());
    });
  }

  // --- Data Loading ---
  async function loadContent() {
    try {
      const res = await fetch('/api/debrief/content');
      if (res.ok) contentData = await res.json();
    } catch (e) { /* use defaults */ }
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/debrief/config');
      if (res.ok) config = await res.json();
    } catch (e) { /* use defaults */ }
  }

  function mergeData() {
    months = DEBRIEF_MONTHS.map(m => {
      const saved = (contentData.months && contentData.months[m.id]) || {};
      return {
        ...m,
        vibe: saved.vibe || m.vibe,
        moodTag: saved.moodTag || m.moodTag,
        songCaption: saved.songCaption || m.songCaption,
        howIFelt: saved.howIFelt || m.howIFelt,
        keyMoment: saved.keyMoment || m.keyMoment,
        kathrineMemory: saved.kathrineMemory || m.kathrineMemory,
        songTitle: saved.songTitle || m.songTitle,
        songArtist: saved.songArtist || m.songArtist,
        spotifyTrackId: saved.spotifyTrackId || m.spotifyTrackId,
        photos: saved.photos || m.photos
      };
    });

    const sd = (contentData.debrief) || {};
    debriefData = {
      reflection: sd.reflection || DEBRIEF_STATIC.reflection,
      lessons: (sd.lessons && sd.lessons.some(l => l)) ? sd.lessons.map((l, i) => l || DEBRIEF_STATIC.lessons[i]) : [...DEBRIEF_STATIC.lessons],
      kathrineNote: sd.kathrineNote || DEBRIEF_STATIC.kathrineNote,
      kathrineQuote: sd.kathrineQuote || DEBRIEF_STATIC.kathrineQuote,
      moments: (sd.moments && sd.moments.length) ? sd.moments.map((m, i) => ({
        number: m.number || DEBRIEF_STATIC.moments[i].number,
        title: m.title || DEBRIEF_STATIC.moments[i].title,
        caption: m.caption || DEBRIEF_STATIC.moments[i].caption
      })) : [...DEBRIEF_STATIC.moments]
    };
  }

  // --- Accent helpers ---
  function accentBg(hex) {
    // Mix hex with black at ~95%
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * 0.05)},${Math.round(g * 0.05)},${Math.round(b * 0.05)})`;
  }

  function accentGlow(hex) {
    return hex + '30';
  }

  // --- Build Slides ---
  function buildSlides() {
    slidesContainer.innerHTML = '';

    // Slide 1: Intro
    const intro = document.createElement('div');
    intro.className = 'slide slide-intro';
    intro.dataset.slideIndex = '0';
    intro.dataset.totalReveals = '0';
    const introVinyl = createVinyl();
    intro.innerHTML = `
      <div class="intro-radial-glow"></div>
      <div class="intro-vinyl vinyl-wrap vinyl-spinning"></div>
      <h1 class="intro-title">My Year</h1>
      <p class="intro-subtitle">A Debrief by Kaliph</p>
      <p class="intro-date">September 2024 – December 2025</p>
      <span class="intro-vol">Vol. I</span>
    `;
    intro.querySelector('.intro-vinyl').appendChild(introVinyl);
    slidesContainer.appendChild(intro);

    // Slides 2-17: Months
    months.forEach((m, i) => {
      const slide = document.createElement('div');
      slide.className = 'slide slide-month';
      slide.dataset.slideIndex = String(i + 1);
      slide.dataset.totalReveals = '8';
      slide.dataset.monthId = m.id;
      slide.style.background = accentBg(m.accentColor);
      slide.style.setProperty('--accent', m.accentColor);
      slide.style.setProperty('--accent-glow', accentGlow(m.accentColor));

      const spotifyBorder = m.accentColor + '66';
      const spotifyShadow = m.accentColor + '33';
      const moodBg = m.accentColor + '26';
      const moodBorder = m.accentColor + '4D';

      slide.innerHTML = `
        <div class="month-left">
          <div class="month-track-label">TRACK ${m.trackNumber}</div>
          <div class="month-year-label">${m.year}</div>
          <div class="month-name">${m.name}</div>
          <div class="reveal-item" data-reveal="1">
            <div class="month-vibe editable" data-field="vibe" data-month="${m.id}">${m.vibe}</div>
          </div>
          <div class="reveal-item" data-reveal="2">
            <span class="month-mood-tag editable" data-field="moodTag" data-month="${m.id}" style="background:${moodBg};color:${m.accentColor};border:1px solid ${moodBorder}">${m.moodTag}</span>
          </div>
          <div class="reveal-item" data-reveal="3">
            <div class="month-section-label">HOW I FELT</div>
            <div class="month-section-text editable" data-field="howIFelt" data-month="${m.id}">${m.howIFelt}</div>
          </div>
          <div class="reveal-item" data-reveal="4">
            <div class="month-section-label">KEY MOMENT</div>
            <div class="month-section-text editable" data-field="keyMoment" data-month="${m.id}">${m.keyMoment}</div>
          </div>
          <div class="reveal-item" data-reveal="5">
            <div class="month-section-label">KATHRINE &amp; I</div>
            <div class="month-section-text editable" data-field="kathrineMemory" data-month="${m.id}">${m.kathrineMemory}</div>
          </div>
        </div>
        <div class="month-right">
          <div class="reveal-item" data-reveal="6">
            <div class="spotify-card" style="border:1px solid ${spotifyBorder};box-shadow:0 0 20px ${spotifyShadow}">
              <div class="spotify-embed" data-track-id="${m.spotifyTrackId}"></div>
            </div>
          </div>
          <div class="reveal-item" data-reveal="7">
            <div class="spotify-song-info">
              <div class="spotify-song-title editable" data-field="songTitle" data-month="${m.id}">${m.songTitle}</div>
              <div class="spotify-song-artist editable" data-field="songArtist" data-month="${m.id}">${m.songArtist}</div>
              <div class="spotify-song-caption editable" data-field="songCaption" data-month="${m.id}">${m.songCaption}</div>
            </div>
          </div>
          <div class="reveal-item" data-reveal="8">
            <div class="photo-filmstrip" id="filmstrip-${m.id}">
              ${buildFilmstrip(m)}
            </div>
            <div class="photo-upload-zone" id="upload-zone-${m.id}">
              <p>Drop photos here or click to upload</p>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic" data-month="${m.id}">
            </div>
          </div>
          ${role === 'editor' ? `
          <div class="reveal-item" data-reveal="6" style="margin-top:8px">
            <div class="settings-section" style="max-width:480px">
              <div class="settings-label">Spotify Track ID</div>
              <input type="text" class="settings-input editable-input" data-field="spotifyTrackId" data-month="${m.id}" value="${m.spotifyTrackId}" placeholder="Spotify Track ID">
            </div>
          </div>` : ''}
        </div>
      `;
      slidesContainer.appendChild(slide);
    });

    // Slide 18: Grand Debrief
    const debrief = document.createElement('div');
    debrief.className = 'slide slide-debrief';
    debrief.dataset.slideIndex = '17';
    debrief.dataset.totalReveals = '5';

    let lessonsHtml = debriefData.lessons.map((l, i) =>
      `<li class="editable" data-field="lesson-${i}" data-debrief="true">${l}</li>`
    ).join('');

    let momentsHtml = debriefData.moments.map(m =>
      `<div class="moment-card">
        <div class="moment-card-number">${m.number}</div>
        <div class="moment-card-title editable" data-field="moment-title-${m.number}" data-debrief="true">${m.title}</div>
        <div class="moment-card-caption editable" data-field="moment-caption-${m.number}" data-debrief="true">${m.caption}</div>
      </div>`
    ).join('');

    debrief.innerHTML = `
      <div class="debrief-particles" id="debrief-particles"></div>
      <div class="debrief-content">
        <div class="debrief-vinyl vinyl-wrap vinyl-spinning"></div>
        <h1 class="debrief-heading">The Debrief</h1>
        <p class="debrief-subheading">Kaliph · 2024–2025</p>
        <hr class="debrief-hr">
        <div class="reveal-item" data-reveal="1">
          <div class="debrief-columns">
            <div>
              <div class="debrief-col-label">MY YEAR IN REFLECTION</div>
              <div class="debrief-reflection editable" data-field="reflection" data-debrief="true">${debriefData.reflection}</div>
            </div>
            <div>
              <div class="debrief-col-label">WHAT I KNOW NOW</div>
              <ul class="debrief-lessons">${lessonsHtml}</ul>
            </div>
          </div>
        </div>
        <div class="reveal-item" data-reveal="2">
          <div class="debrief-kathrine">
            <h2 class="debrief-kathrine-heading">&amp; then there's Kathrine.</h2>
            <p class="debrief-kathrine-text editable" data-field="kathrineNote" data-debrief="true">${debriefData.kathrineNote}</p>
          </div>
        </div>
        <div class="reveal-item" data-reveal="3">
          <div class="debrief-quote">
            <span class="debrief-quote-mark">"</span>
            <p class="debrief-quote-text editable" data-field="kathrineQuote" data-debrief="true">${debriefData.kathrineQuote}</p>
          </div>
        </div>
        <div class="reveal-item" data-reveal="4">
          <div class="debrief-moments-label">Moments That Defined My Year</div>
          <div class="debrief-moments-row">${momentsHtml}</div>
        </div>
        <div class="reveal-item" data-reveal="5">
          <div class="debrief-footer">
            <div class="debrief-footer-vinyl vinyl-wrap vinyl-spinning"></div>
            <p class="debrief-footer-text">To be continued... Vol. II</p>
          </div>
        </div>
      </div>
    `;
    debrief.querySelector('.debrief-vinyl').appendChild(createVinyl());
    debrief.querySelector('.debrief-footer-vinyl').appendChild(createVinyl());
    slidesContainer.appendChild(debrief);

    // Create particles
    createParticles();

    // Slide 19: Credits
    const credits = document.createElement('div');
    credits.className = 'slide slide-credits';
    credits.dataset.slideIndex = '18';
    credits.dataset.totalReveals = '0';
    credits.innerHTML = `
      <h1 class="credits-title">My Year: A Debrief</h1>
      <p class="credits-by">By Kaliph · 2026</p>
      <p class="credits-presented">Presented to Kathrine</p>
      <p class="credits-her">Her version coming soon.</p>
      <div class="credits-vinyl vinyl-wrap vinyl-spinning"></div>
      <p class="credits-vol">Vol. I · Sep 2024 – Dec 2025</p>
    `;
    credits.querySelector('.credits-vinyl').appendChild(createVinyl());
    slidesContainer.appendChild(credits);

    // Build dot nav
    buildDotNav();
  }

  function buildFilmstrip(m) {
    if (!m.photos || m.photos.length === 0) {
      return `<div class="filmstrip-placeholder">+</div><div class="filmstrip-placeholder">+</div>`;
    }
    return m.photos.map(p =>
      `<div class="filmstrip-frame">
        <img src="/uploads/debrief/${m.id}/${p}" alt="Photo" loading="lazy">
        <button class="photo-delete" data-month="${m.id}" data-filename="${p}">&times;</button>
      </div>`
    ).join('');
  }

  function createParticles() {
    const container = document.getElementById('debrief-particles');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'debrief-particle';
      const size = 1 + Math.random() * 2;
      p.style.cssText = `
        width: ${size}px; height: ${size}px;
        left: ${Math.random() * 100}%; top: ${Math.random() * 100}%;
        opacity: ${0.1 + Math.random() * 0.15};
        animation-duration: ${15 + Math.random() * 20}s;
        animation-delay: ${-Math.random() * 20}s;
      `;
      container.appendChild(p);
    }
  }

  function buildDotNav() {
    dotNav.innerHTML = '';
    for (let i = 0; i < totalSlides; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot-nav-item';
      dot.dataset.index = i;
      if (role === 'presenter') {
        dot.addEventListener('click', () => goToSlide(i));
      }
      dotNav.appendChild(dot);
    }
    updateDotNav();
  }

  function updateDotNav() {
    const dots = dotNav.querySelectorAll('.dot-nav-item');
    let accent = '#fff';
    if (slideIndex >= 1 && slideIndex <= 16) {
      accent = months[slideIndex - 1].accentColor;
    }
    dotNav.style.setProperty('--nav-accent', accent);
    dots.forEach((d, i) => d.classList.toggle('active', i === slideIndex));
  }

  // --- Slide Navigation ---
  function goToSlide(newIndex, direction) {
    if (newIndex < 0 || newIndex >= totalSlides || newIndex === slideIndex) return;

    const slides = slidesContainer.querySelectorAll('.slide');
    const oldSlide = slides[slideIndex];
    const newSlide = slides[newIndex];
    const goForward = direction !== undefined ? direction === 'forward' : newIndex > slideIndex;

    // Remove old animation classes
    slides.forEach(s => {
      s.classList.remove('slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right', 'active');
    });

    if (goForward) {
      oldSlide.classList.add('slide-exit-left');
      newSlide.classList.add('slide-enter-right', 'active');
    } else {
      oldSlide.classList.add('slide-exit-right');
      newSlide.classList.add('slide-enter-left', 'active');
    }

    slideIndex = newIndex;
    revealStep = 0;

    updateUI();
    loadSpotifyEmbed();
    updateSlideAudio();

    // Broadcast if presenter
    if (role === 'presenter') {
      socket.emit('debrief:slide-change', { slideIndex });
    }
  }

  function revealNext() {
    const slide = slidesContainer.querySelectorAll('.slide')[slideIndex];
    const totalReveals = parseInt(slide.dataset.totalReveals || '0');

    if (revealStep < totalReveals) {
      revealStep++;
      applyReveals(slide);

      if (role === 'presenter') {
        socket.emit('debrief:reveal', { slideIndex, revealStep });
      }
    } else if (role === 'presenter' || role === 'editor') {
      // All revealed — advance to next slide
      goToSlide(slideIndex + 1);
    }
  }

  function applyReveals(slide) {
    if (!slide) return;
    const items = slide.querySelectorAll('.reveal-item');
    items.forEach(item => {
      const step = parseInt(item.dataset.reveal);
      item.classList.toggle('revealed', step <= revealStep);
    });

    // Load Spotify embed on reveal 6
    if (revealStep >= 6) loadSpotifyEmbed();

    updateRevealCounter(slide);
  }

  function updateUI() {
    // Slide counter
    slideCounter.textContent = `${String(slideIndex + 1).padStart(2, '0')} / ${totalSlides}`;

    // Dot nav
    updateDotNav();

    // Reveal counter
    const slide = slidesContainer.querySelectorAll('.slide')[slideIndex];
    updateRevealCounter(slide);
  }

  function updateRevealCounter(slide) {
    if (!slide) return;
    const total = parseInt(slide.dataset.totalReveals || '0');
    revealCounter.textContent = total > 0 ? `Step ${revealStep} / ${total}` : '';
  }

  function loadSpotifyEmbed() {
    const slide = slidesContainer.querySelectorAll('.slide')[slideIndex];
    if (!slide) return;
    const embedContainer = slide.querySelector('.spotify-embed');
    if (!embedContainer) return;
    const trackId = embedContainer.dataset.trackId;
    if (!trackId || embedContainer.querySelector('iframe')) return;

    const iframe = document.createElement('iframe');
    iframe.src = `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`;
    iframe.width = '100%';
    iframe.height = '152';
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.loading = 'lazy';
    iframe.style.borderRadius = '8px';
    embedContainer.appendChild(iframe);
  }

  // --- Audio System ---
  function initGateAudio() {
    if (!config.gateSongUrl) return;
    gateAudio.src = config.gateSongUrl;
    gateAudio.volume = 0;
    gateAudio.muted = true;

    const playPromise = gateAudio.play();
    if (playPromise) {
      playPromise.then(() => {
        gateAudio.muted = false;
        fadeAudioIn(gateAudio, config.globalVolume || 0.4, 2000);
      }).catch(() => {
        audioPrompt.classList.add('visible');
        document.addEventListener('click', enableAudioOnce, { once: true });
      });
    }
  }

  function enableAudioOnce() {
    audioPrompt.classList.remove('visible');
    if (gateAudio.src) {
      gateAudio.muted = false;
      gateAudio.play().then(() => {
        fadeAudioIn(gateAudio, config.globalVolume || 0.4, 2000);
      }).catch(() => {});
    }
  }

  function fadeAudioIn(el, targetVol, duration) {
    if (audioMuted) { el.volume = 0; return; }
    el.volume = 0;
    const steps = 20;
    const stepTime = duration / steps;
    const stepVol = targetVol / steps;
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      el.volume = Math.min(stepVol * currentStep, targetVol);
      if (currentStep >= steps) clearInterval(interval);
    }, stepTime);
  }

  function fadeAudioOut(el, duration) {
    const startVol = el.volume;
    if (startVol === 0) return Promise.resolve();
    return new Promise(resolve => {
      const steps = 20;
      const stepTime = duration / steps;
      const stepVol = startVol / steps;
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        el.volume = Math.max(startVol - stepVol * currentStep, 0);
        if (currentStep >= steps) {
          clearInterval(interval);
          el.pause();
          el.volume = 0;
          resolve();
        }
      }, stepTime);
    });
  }

  function updateSlideAudio() {
    const monthIdx = slideIndex - 1;
    let bgUrl = '';

    if (monthIdx >= 0 && monthIdx < 16 && config.months) {
      const mCfg = config.months[months[monthIdx].id];
      if (mCfg) bgUrl = mCfg.bgAudioUrl || '';
    }

    if (!bgUrl) {
      fadeAudioOut(slideAudio, 1000);
      return;
    }

    if (slideAudio.src && slideAudio.src.endsWith(bgUrl)) return;

    fadeAudioOut(slideAudio, 1000).then(() => {
      slideAudio.src = bgUrl;
      slideAudio.play().then(() => {
        fadeAudioIn(slideAudio, 0.35, 1000);
      }).catch(() => {});
    });
  }

  audioToggle.addEventListener('click', () => {
    audioMuted = !audioMuted;
    audioIconOn.style.display = audioMuted ? 'none' : 'block';
    audioIconOff.style.display = audioMuted ? 'block' : 'none';

    [gateAudio, slideAudio].forEach(a => {
      if (audioMuted) { a.volume = 0; }
      else if (!a.paused) { fadeAudioIn(a, a === gateAudio ? (config.globalVolume || 0.4) : 0.35, 500); }
    });
  });

  // --- Gate Screen ---
  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = gatePassword.value;
    if (!pw) return;

    try {
      const res = await fetch('/api/debrief/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const data = await res.json();
      if (data.role) {
        role = data.role;
        enterPresentation();
      } else {
        gatePassword.classList.add('shake');
        gateError.classList.add('visible');
        setTimeout(() => {
          gatePassword.classList.remove('shake');
          gateError.classList.remove('visible');
        }, 1500);
      }
    } catch (err) {
      gateError.textContent = 'Connection error.';
      gateError.classList.add('visible');
    }
  });

  async function enterPresentation() {
    // Fade out gate audio
    fadeAudioOut(gateAudio, 600);

    // Hide gate
    gateScreen.classList.add('hidden');
    setTimeout(() => { gateScreen.style.display = 'none'; }, 600);

    // Show presentation
    presentation.classList.add('active');

    // Set role classes
    if (role === 'presenter') {
      document.body.classList.add('presenter-mode');
      roleBadge.textContent = 'PRESENTING';
      roleBadge.classList.add('presenter');
      waitingScreen.classList.add('hidden');
      socket.emit('debrief:presenter-join');
    } else if (role === 'viewer') {
      roleBadge.textContent = 'VIEWING';
      roleBadge.classList.add('viewer');
      waitingScreen.classList.remove('hidden');
      socket.emit('debrief:request-state');
    } else if (role === 'editor') {
      document.body.classList.add('editor-mode');
      roleBadge.textContent = 'EDITING';
      roleBadge.classList.add('editor');
      waitingScreen.classList.add('hidden');
      initEditorMode();
    }

    // Build and show first slide
    buildSlides();
    showSlide(0);
  }

  function showSlide(idx) {
    const slides = slidesContainer.querySelectorAll('.slide');
    slides.forEach((s, i) => {
      s.classList.remove('active', 'slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
      if (i === idx) s.classList.add('active');
    });
    slideIndex = idx;
    updateUI();
    updateSlideAudio();

    // In editor mode, reveal everything
    if (role === 'editor') {
      const slide = slides[idx];
      if (slide) {
        const total = parseInt(slide.dataset.totalReveals || '0');
        revealStep = total;
        applyReveals(slide);
      }
    }
  }

  // --- Keyboard Controls ---
  document.addEventListener('keydown', (e) => {
    if (role !== 'presenter' && role !== 'editor') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        goToSlide(slideIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        goToSlide(slideIndex - 1);
        break;
      case ' ':
        e.preventDefault();
        revealNext();
        break;
    }
  });

  // Presenter controls
  document.getElementById('btn-prev').addEventListener('click', () => goToSlide(slideIndex - 1));
  document.getElementById('btn-next').addEventListener('click', () => goToSlide(slideIndex + 1));
  document.getElementById('btn-reveal').addEventListener('click', () => revealNext());

  // Editor toolbar controls
  document.getElementById('edit-prev').addEventListener('click', () => {
    goToSlide(slideIndex - 1);
    // Re-reveal all in editor
    setTimeout(() => {
      const slides = slidesContainer.querySelectorAll('.slide');
      const slide = slides[slideIndex];
      if (slide) {
        const total = parseInt(slide.dataset.totalReveals || '0');
        revealStep = total;
        applyReveals(slide);
      }
    }, 500);
  });
  document.getElementById('edit-next').addEventListener('click', () => {
    goToSlide(slideIndex + 1);
    setTimeout(() => {
      const slides = slidesContainer.querySelectorAll('.slide');
      const slide = slides[slideIndex];
      if (slide) {
        const total = parseInt(slide.dataset.totalReveals || '0');
        revealStep = total;
        applyReveals(slide);
      }
    }, 500);
  });

  // --- Socket.io Sync ---
  socket.on('debrief:slide-change', (data) => {
    if (role === 'viewer') {
      goToSlide(data.slideIndex);
    }
  });

  socket.on('debrief:reveal', (data) => {
    if (role === 'viewer') {
      slideIndex = data.slideIndex;
      revealStep = data.revealStep;
      const slides = slidesContainer.querySelectorAll('.slide');
      applyReveals(slides[slideIndex]);
      updateUI();
    }
  });

  socket.on('debrief:presenter-join', () => {
    if (role === 'viewer') {
      presenterConnected = true;
      waitingScreen.classList.add('hidden');
      socket.emit('debrief:request-state');
    }
  });

  socket.on('debrief:presenter-leave', () => {
    if (role === 'viewer') {
      presenterConnected = false;
      waitingScreen.classList.remove('hidden');
    }
  });

  socket.on('debrief:state', (data) => {
    if (role === 'viewer' && data) {
      presenterConnected = true;
      waitingScreen.classList.add('hidden');
      slideIndex = data.slideIndex || 0;
      revealStep = data.revealStep || 0;

      const slides = slidesContainer.querySelectorAll('.slide');
      slides.forEach((s, i) => {
        s.classList.remove('active', 'slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
        if (i === slideIndex) s.classList.add('active');
      });
      applyReveals(slides[slideIndex]);
      updateUI();
      loadSpotifyEmbed();
      updateSlideAudio();
    }
  });

  // --- Editor Mode ---
  function initEditorMode() {
    // Make editable fields contenteditable
    document.addEventListener('click', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable');
      if (el && !el.isContentEditable) {
        el.contentEditable = 'true';
        el.focus();
      }
    });

    document.addEventListener('focusout', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable');
      if (el && el.isContentEditable) {
        el.contentEditable = 'false';
        saveField(el);
      }
    });

    // Input fields (like spotify track ID)
    document.addEventListener('change', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable-input');
      if (el) saveInputField(el);
    });

    // Settings
    document.getElementById('edit-settings-btn').addEventListener('click', () => {
      settingsDrawer.classList.toggle('open');
      if (settingsDrawer.classList.contains('open')) populateSettings();
    });

    document.getElementById('setting-gate-song').addEventListener('change', async (e) => {
      config.gateSongUrl = e.target.value;
      await saveConfig();
    });

    document.getElementById('setting-bg-audio').addEventListener('change', async (e) => {
      const monthId = getCurrentMonthId();
      if (monthId && config.months) {
        if (!config.months[monthId]) config.months[monthId] = {};
        config.months[monthId].bgAudioUrl = e.target.value;
        await saveConfig();
      }
    });

    document.getElementById('setting-grain').addEventListener('change', (e) => {
      document.querySelector('.grain-overlay').style.display = e.target.checked ? '' : 'none';
    });

    // Save All
    document.getElementById('edit-save').addEventListener('click', saveAllContent);

    // Photo uploads
    document.addEventListener('click', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) zone.querySelector('input[type="file"]').click();
    });

    document.addEventListener('change', (e) => {
      if (e.target.matches('.photo-upload-zone input[type="file"]')) {
        uploadPhotos(e.target.dataset.month, e.target.files);
      }
    });

    // Photo delete
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.photo-delete');
      if (!btn) return;
      const monthId = btn.dataset.month;
      const filename = btn.dataset.filename;
      await fetch('/api/debrief/photo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthId, filename })
      });
      await loadContent();
      mergeData();
      refreshFilmstrip(monthId);
    });

    // Drag-and-drop on upload zones
    document.addEventListener('dragover', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) { e.preventDefault(); zone.style.borderColor = 'rgba(255,200,100,0.5)'; }
    });
    document.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) zone.style.borderColor = '';
    });
    document.addEventListener('drop', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (!zone) return;
      e.preventDefault();
      zone.style.borderColor = '';
      const monthId = zone.querySelector('input[type="file"]').dataset.month;
      uploadPhotos(monthId, e.dataTransfer.files);
    });
  }

  function getCurrentMonthId() {
    if (slideIndex >= 1 && slideIndex <= 16) {
      return months[slideIndex - 1].id;
    }
    return null;
  }

  function populateSettings() {
    document.getElementById('setting-gate-song').value = config.gateSongUrl || '';
    const monthId = getCurrentMonthId();
    if (monthId && config.months && config.months[monthId]) {
      document.getElementById('setting-bg-audio').value = config.months[monthId].bgAudioUrl || '';
    } else {
      document.getElementById('setting-bg-audio').value = '';
    }
  }

  async function saveField(el) {
    const field = el.dataset.field;
    const monthId = el.dataset.month;
    const isDebrief = el.dataset.debrief === 'true';
    const value = el.textContent.trim();

    if (monthId) {
      if (!contentData.months) contentData.months = {};
      if (!contentData.months[monthId]) contentData.months[monthId] = {};
      contentData.months[monthId][field] = value;
    } else if (isDebrief) {
      if (!contentData.debrief) contentData.debrief = {};
      if (field === 'reflection') contentData.debrief.reflection = value;
      else if (field === 'kathrineNote') contentData.debrief.kathrineNote = value;
      else if (field === 'kathrineQuote') contentData.debrief.kathrineQuote = value;
      else if (field.startsWith('lesson-')) {
        const idx = parseInt(field.split('-')[1]);
        if (!contentData.debrief.lessons) contentData.debrief.lessons = ['', '', '', '', ''];
        contentData.debrief.lessons[idx] = value;
      } else if (field.startsWith('moment-title-')) {
        const num = field.split('-')[2];
        if (!contentData.debrief.moments) contentData.debrief.moments = DEBRIEF_STATIC.moments.map(m => ({ ...m }));
        const moment = contentData.debrief.moments.find(m => m.number === num);
        if (moment) moment.title = value;
      } else if (field.startsWith('moment-caption-')) {
        const num = field.split('-')[2];
        if (!contentData.debrief.moments) contentData.debrief.moments = DEBRIEF_STATIC.moments.map(m => ({ ...m }));
        const moment = contentData.debrief.moments.find(m => m.number === num);
        if (moment) moment.caption = value;
      }
    }

    await saveAllContent();
  }

  async function saveInputField(el) {
    const field = el.dataset.field;
    const monthId = el.dataset.month;
    const value = el.value.trim();

    if (monthId) {
      if (!contentData.months) contentData.months = {};
      if (!contentData.months[monthId]) contentData.months[monthId] = {};
      contentData.months[monthId][field] = value;

      // If spotify track ID changed, update the embed
      if (field === 'spotifyTrackId') {
        const embed = el.closest('.slide').querySelector('.spotify-embed');
        if (embed) {
          embed.dataset.trackId = value;
          embed.innerHTML = '';
          loadSpotifyEmbed();
        }
      }
    }

    await saveAllContent();
  }

  async function saveAllContent() {
    try {
      await fetch('/api/debrief/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contentData)
      });
    } catch (e) {
      console.error('Save failed:', e);
    }
  }

  async function saveConfig() {
    try {
      await fetch('/api/debrief/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
    } catch (e) {
      console.error('Config save failed:', e);
    }
  }

  async function uploadPhotos(monthId, files) {
    if (!files || !files.length) return;
    const formData = new FormData();
    for (const f of files) formData.append('photos', f);

    try {
      await fetch(`/api/debrief/upload/${monthId}`, {
        method: 'POST',
        body: formData
      });
      await loadContent();
      mergeData();
      refreshFilmstrip(monthId);
    } catch (e) {
      console.error('Upload failed:', e);
    }
  }

  function refreshFilmstrip(monthId) {
    const m = months.find(x => x.id === monthId);
    if (!m) return;
    const strip = document.getElementById(`filmstrip-${monthId}`);
    if (strip) strip.innerHTML = buildFilmstrip(m);
  }

  // --- Init ---
  async function init() {
    injectVinyls();
    await Promise.all([loadContent(), loadConfig()]);
    mergeData();
    initGateAudio();
  }

  init();
})();
