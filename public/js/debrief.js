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
  let transitioning = false;

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
  const settingsDrawer = document.getElementById('settings-drawer');

  // --- Vinyl helper ---
  function createVinyl() {
    const tpl = document.getElementById('vinyl-template');
    return tpl.content.cloneNode(true).querySelector('svg');
  }

  function injectVinyls() {
    ['gate-vinyl', 'waiting-vinyl'].forEach(id => {
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
        audioFile: saved.audioFile || '',
        coverFile: saved.coverFile || '',
        photos: saved.photos || m.photos
      };
    });

    const sd = (contentData.debrief) || {};
    debriefData = {
      reflection: sd.reflection || DEBRIEF_STATIC.reflection,
      lessons: (sd.lessons && sd.lessons.some(l => l))
        ? sd.lessons.map((l, i) => l || DEBRIEF_STATIC.lessons[i])
        : [...DEBRIEF_STATIC.lessons],
      kathrineNote: sd.kathrineNote || DEBRIEF_STATIC.kathrineNote,
      kathrineQuote: sd.kathrineQuote || DEBRIEF_STATIC.kathrineQuote,
      moments: (sd.moments && sd.moments.length)
        ? sd.moments.map((m, i) => ({
            number: m.number || DEBRIEF_STATIC.moments[i].number,
            title: m.title || DEBRIEF_STATIC.moments[i].title,
            caption: m.caption || DEBRIEF_STATIC.moments[i].caption
          }))
        : DEBRIEF_STATIC.moments.map(m => ({ ...m }))
    };
  }

  // --- Accent helpers ---
  function accentBg(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * 0.05)},${Math.round(g * 0.05)},${Math.round(b * 0.05)})`;
  }

  // --- Build Slides ---
  function buildSlides() {
    slidesContainer.innerHTML = '';

    // Slide 1: Intro
    const intro = document.createElement('div');
    intro.className = 'slide slide-intro';
    intro.dataset.slideIndex = '0';
    intro.dataset.totalReveals = '0';
    intro.innerHTML = `
      <div class="intro-radial-glow"></div>
      <div class="intro-vinyl vinyl-wrap vinyl-spinning"></div>
      <h1 class="intro-title">My Year</h1>
      <p class="intro-subtitle">A Debrief by Kaliph</p>
      <p class="intro-date">September 2024 – December 2025</p>
      <span class="intro-vol">Vol. I</span>
    `;
    intro.querySelector('.intro-vinyl').appendChild(createVinyl());
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
      slide.style.setProperty('--accent-glow', m.accentColor + '30');

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
            <div class="vinyl-player" data-month="${m.id}" style="--player-accent:${m.accentColor}">
              <div class="vinyl-player-disc ${m.audioFile ? 'has-audio' : ''}" id="disc-${m.id}">
                <svg class="vinyl-player-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="140" cy="140" r="138" fill="#111" stroke="${m.accentColor}44" stroke-width="1"/>
                  <circle cx="140" cy="140" r="120" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="105" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="90" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="75" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
                  <!-- Cover art clipped circle -->
                  <defs>
                    <clipPath id="cover-clip-${m.id}">
                      <circle cx="140" cy="140" r="52"/>
                    </clipPath>
                  </defs>
                  ${m.coverFile
                    ? `<image href="/uploads/debrief/covers/${m.coverFile}" x="88" y="88" width="104" height="104" clip-path="url(#cover-clip-${m.id})" preserveAspectRatio="xMidYMid slice"/>`
                    : `<circle cx="140" cy="140" r="52" fill="#1a1a1a"/>`
                  }
                  <circle cx="140" cy="140" r="6" fill="#0a0a0a"/>
                  ${!m.coverFile ? `
                  <text x="140" y="135" text-anchor="middle" font-family="Space Mono, monospace" font-size="8" fill="rgba(255,255,255,0.4)" letter-spacing="1.5">NOW PLAYING</text>
                  <text x="140" y="148" text-anchor="middle" font-family="Space Mono, monospace" font-size="6" fill="rgba(255,255,255,0.25)">${m.trackNumber}</text>
                  ` : ''}
                </svg>
                <button class="vinyl-play-btn" data-month="${m.id}" title="Play/Pause">
                  <svg viewBox="0 0 24 24" class="play-icon"><polygon points="5,3 19,12 5,21" fill="white"/></svg>
                  <svg viewBox="0 0 24 24" class="pause-icon" style="display:none"><rect x="5" y="3" width="4" height="18" fill="white"/><rect x="15" y="3" width="4" height="18" fill="white"/></svg>
                </button>
              </div>
              <div class="vinyl-player-glow" style="background:radial-gradient(circle, ${m.accentColor}15 0%, transparent 70%)"></div>
            </div>
          </div>
          <div class="reveal-item" data-reveal="7">
            <div class="song-info">
              <div class="song-now-playing">NOW PLAYING</div>
              <div class="song-title editable" data-field="songTitle" data-month="${m.id}">${m.songTitle}</div>
              <div class="song-artist editable" data-field="songArtist" data-month="${m.id}">${m.songArtist}</div>
              <div class="song-caption editable" data-field="songCaption" data-month="${m.id}">${m.songCaption}</div>
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
          <div class="editor-only-fields" style="display:none; margin-top:16px; max-width:480px;">
            <div class="editor-upload-row">
              <div class="editor-upload-box">
                <div class="settings-label">Audio File</div>
                <button class="editor-upload-btn audio-upload-btn" data-month="${m.id}">${m.audioFile ? '✓ ' + m.audioFile : 'Upload MP3'}</button>
                <input type="file" class="audio-file-input" data-month="${m.id}" accept=".mp3,.m4a,.ogg,.wav,.aac" style="display:none">
              </div>
              <div class="editor-upload-box">
                <div class="settings-label">Cover Art</div>
                <button class="editor-upload-btn cover-upload-btn" data-month="${m.id}">${m.coverFile ? '✓ ' + m.coverFile : 'Upload Cover'}</button>
                <input type="file" class="cover-file-input" data-month="${m.id}" accept=".jpg,.jpeg,.png,.webp" style="display:none">
              </div>
            </div>
          </div>
        </div>
      `;
      slidesContainer.appendChild(slide);
    });

    // Slide 18: Grand Debrief
    const debrief = document.createElement('div');
    debrief.className = 'slide slide-debrief';
    debrief.dataset.slideIndex = '17';
    debrief.dataset.totalReveals = '5';

    const lessonsHtml = debriefData.lessons.map((l, i) =>
      `<li class="editable" data-field="lesson-${i}" data-debrief="true">${l}</li>`
    ).join('');

    const momentsHtml = debriefData.moments.map(m =>
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
            <span class="debrief-quote-mark">&ldquo;</span>
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

    // Show editor-only fields if editor
    if (role === 'editor') {
      slidesContainer.querySelectorAll('.editor-only-fields').forEach(el => {
        el.style.display = 'block';
      });
    }

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
        width:${size}px; height:${size}px;
        left:${Math.random() * 100}%; top:${Math.random() * 100}%;
        opacity:${0.1 + Math.random() * 0.15};
        animation-duration:${15 + Math.random() * 20}s;
        animation-delay:${-Math.random() * 20}s;
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
      if (role === 'presenter' || role === 'editor') {
        dot.addEventListener('click', () => navigateToSlide(i));
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
  // This is the core fix: use a simpler, more reliable approach
  function navigateToSlide(newIndex, direction) {
    if (newIndex < 0 || newIndex >= totalSlides || newIndex === slideIndex) return;
    if (transitioning) return;

    const slides = slidesContainer.querySelectorAll('.slide');
    const oldSlide = slides[slideIndex];
    const newSlide = slides[newIndex];
    const goForward = direction !== undefined ? direction === 'forward' : newIndex > slideIndex;

    transitioning = true;

    // Clean ALL animation classes from ALL slides first
    slides.forEach(s => {
      s.classList.remove('slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
    });

    // Force browser to acknowledge the class removal before adding new ones
    void newSlide.offsetWidth;

    // Set new slide as active immediately
    newSlide.classList.add('active');

    // Apply transition animations
    if (goForward) {
      oldSlide.classList.add('slide-exit-left');
      newSlide.classList.add('slide-enter-right');
    } else {
      oldSlide.classList.add('slide-exit-right');
      newSlide.classList.add('slide-enter-left');
    }

    const prevIndex = slideIndex;
    slideIndex = newIndex;
    revealStep = 0;

    // After animation completes, clean up
    setTimeout(() => {
      // Remove active + animation from old slide
      oldSlide.classList.remove('active', 'slide-exit-left', 'slide-exit-right');
      // Remove animation classes from new slide (keep active)
      newSlide.classList.remove('slide-enter-right', 'slide-enter-left');
      transitioning = false;
    }, 480);

    // If editor mode, reveal everything immediately
    if (role === 'editor') {
      const total = parseInt(newSlide.dataset.totalReveals || '0');
      revealStep = total;
      revealAllItems(newSlide);
    }

    updateUI();
    loadSpotifyEmbed(newSlide);
    updateSlideAudio();

    // Broadcast if presenter
    if (role === 'presenter') {
      socket.emit('debrief:slide-change', { slideIndex });
    }
  }

  // Jump to slide without animation (for initial load, viewer sync)
  function jumpToSlide(idx) {
    const slides = slidesContainer.querySelectorAll('.slide');
    slides.forEach(s => {
      s.classList.remove('active', 'slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
    });
    slideIndex = idx;
    const slide = slides[idx];
    if (slide) {
      slide.classList.add('active');

      // Editor: reveal everything
      if (role === 'editor') {
        const total = parseInt(slide.dataset.totalReveals || '0');
        revealStep = total;
        revealAllItems(slide);
      }

      loadSpotifyEmbed(slide);
    }
    updateUI();
    updateSlideAudio();
  }

  function revealAllItems(slide) {
    if (!slide) return;
    slide.querySelectorAll('.reveal-item').forEach(item => {
      item.classList.add('revealed');
    });
  }

  function revealNext() {
    const slides = slidesContainer.querySelectorAll('.slide');
    const slide = slides[slideIndex];
    const totalReveals = parseInt(slide.dataset.totalReveals || '0');

    if (revealStep < totalReveals) {
      revealStep++;
      applyReveals(slide);

      if (role === 'presenter') {
        socket.emit('debrief:reveal', { slideIndex, revealStep });
      }
    } else if (role === 'presenter' || role === 'editor') {
      navigateToSlide(slideIndex + 1);
    }
  }

  function applyReveals(slide) {
    if (!slide) return;
    slide.querySelectorAll('.reveal-item').forEach(item => {
      const step = parseInt(item.dataset.reveal);
      item.classList.toggle('revealed', step <= revealStep);
    });

    if (revealStep >= 6) loadSpotifyEmbed(slide);
    updateRevealCounter(slide);
  }

  function updateUI() {
    slideCounter.textContent = `${String(slideIndex + 1).padStart(2, '0')} / ${totalSlides}`;
    updateDotNav();
    const slides = slidesContainer.querySelectorAll('.slide');
    updateRevealCounter(slides[slideIndex]);
  }

  function updateRevealCounter(slide) {
    if (!slide) return;
    const total = parseInt(slide.dataset.totalReveals || '0');
    revealCounter.textContent = total > 0 ? `Step ${revealStep} / ${total}` : '';
  }

  // Spotify embed removed — using uploaded audio files with vinyl player instead
  function loadSpotifyEmbed() { /* no-op */ }

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
    if (gateAudio.src && gateAudio.src !== window.location.href) {
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
    let cur = 0;
    const iv = setInterval(() => {
      cur++;
      el.volume = Math.min(stepVol * cur, targetVol);
      if (cur >= steps) clearInterval(iv);
    }, stepTime);
  }

  function fadeAudioOut(el, duration) {
    const startVol = el.volume;
    if (startVol === 0) { el.pause(); return Promise.resolve(); }
    return new Promise(resolve => {
      const steps = 20;
      const stepTime = duration / steps;
      const stepVol = startVol / steps;
      let cur = 0;
      const iv = setInterval(() => {
        cur++;
        el.volume = Math.max(startVol - stepVol * cur, 0);
        if (cur >= steps) {
          clearInterval(iv);
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

    // Check for uploaded audio file first
    if (monthIdx >= 0 && monthIdx < 16) {
      const m = months[monthIdx];
      if (m.audioFile) {
        bgUrl = `/uploads/debrief/audio/${m.audioFile}`;
      }
    }

    // Fallback to config bg audio URL
    if (!bgUrl && monthIdx >= 0 && monthIdx < 16 && config.months) {
      const mCfg = config.months[months[monthIdx].id];
      if (mCfg) bgUrl = mCfg.bgAudioUrl || '';
    }

    if (!bgUrl) {
      fadeAudioOut(slideAudio, 1000);
      updateDiscSpinState(false);
      return;
    }

    // Don't restart same audio
    if (slideAudio.src && slideAudio.src.endsWith(bgUrl.split('/').pop())) return;

    fadeAudioOut(slideAudio, 1000).then(() => {
      slideAudio.src = bgUrl;
      slideAudio.play().then(() => {
        fadeAudioIn(slideAudio, 0.35, 1000);
        updateDiscSpinState(true);
      }).catch(() => {
        updateDiscSpinState(false);
      });
    });
  }

  function updateDiscSpinState(playing) {
    // Update vinyl disc spin for current slide
    const monthIdx = slideIndex - 1;
    if (monthIdx < 0 || monthIdx >= 16) return;
    const monthId = months[monthIdx].id;
    const disc = document.getElementById(`disc-${monthId}`);
    if (disc) {
      disc.classList.toggle('spinning', playing);
    }
    // Update play/pause button icons
    const btn = disc && disc.querySelector('.vinyl-play-btn');
    if (btn) {
      btn.querySelector('.play-icon').style.display = playing ? 'none' : 'block';
      btn.querySelector('.pause-icon').style.display = playing ? 'block' : 'none';
    }
  }

  audioToggle.addEventListener('click', () => {
    audioMuted = !audioMuted;
    audioIconOn.style.display = audioMuted ? 'none' : 'block';
    audioIconOff.style.display = audioMuted ? 'block' : 'none';

    [gateAudio, slideAudio].forEach(a => {
      if (audioMuted) { a.volume = 0; }
      else if (!a.paused) {
        fadeAudioIn(a, a === gateAudio ? (config.globalVolume || 0.4) : 0.35, 500);
      }
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
        // Reload content fresh before entering
        await Promise.all([loadContent(), loadConfig()]);
        mergeData();
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

  function enterPresentation() {
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
    jumpToSlide(0);
  }

  // --- Keyboard Controls ---
  document.addEventListener('keydown', (e) => {
    if (role !== 'presenter' && role !== 'editor') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        navigateToSlide(slideIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        navigateToSlide(slideIndex - 1);
        break;
      case ' ':
        e.preventDefault();
        revealNext();
        break;
    }
  });

  // Presenter controls
  document.getElementById('btn-prev').addEventListener('click', () => navigateToSlide(slideIndex - 1));
  document.getElementById('btn-next').addEventListener('click', () => navigateToSlide(slideIndex + 1));
  document.getElementById('btn-reveal').addEventListener('click', () => revealNext());

  // Editor toolbar controls
  document.getElementById('edit-prev').addEventListener('click', () => navigateToSlide(slideIndex - 1));
  document.getElementById('edit-next').addEventListener('click', () => navigateToSlide(slideIndex + 1));

  // --- Socket.io Sync ---
  socket.on('debrief:slide-change', (data) => {
    if (role === 'viewer') {
      const slides = slidesContainer.querySelectorAll('.slide');
      if (!slides.length) return;
      navigateToSlide(data.slideIndex);
    }
  });

  socket.on('debrief:reveal', (data) => {
    if (role === 'viewer') {
      const slides = slidesContainer.querySelectorAll('.slide');
      if (!slides.length) return;
      slideIndex = data.slideIndex;
      revealStep = data.revealStep;
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

      const slides = slidesContainer.querySelectorAll('.slide');
      if (!slides.length) return;

      slideIndex = data.slideIndex || 0;
      revealStep = data.revealStep || 0;

      slides.forEach((s, i) => {
        s.classList.remove('active', 'slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
        if (i === slideIndex) s.classList.add('active');
      });
      applyReveals(slides[slideIndex]);
      updateUI();
      loadSpotifyEmbed(slides[slideIndex]);
      updateSlideAudio();
    }
  });

  // --- Editor Mode ---
  function initEditorMode() {
    // Click to edit any .editable element
    document.addEventListener('click', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable');
      if (el && !el.isContentEditable) {
        el.contentEditable = 'true';
        el.focus();
      }
    });

    // Save on blur
    document.addEventListener('focusout', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable');
      if (el && el.isContentEditable) {
        el.contentEditable = 'false';
        saveField(el);
      }
    });

    // Input fields (spotify track ID, bg audio)
    document.addEventListener('change', (e) => {
      if (role !== 'editor') return;
      const el = e.target.closest('.editable-input');
      if (el) {
        if (el.classList.contains('bg-audio-input')) {
          saveBgAudioField(el);
        } else {
          saveInputField(el);
        }
      }
    });

    // Settings drawer
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
      if (monthId) {
        if (!config.months) config.months = {};
        if (!config.months[monthId]) config.months[monthId] = {};
        config.months[monthId].bgAudioUrl = e.target.value;
        await saveConfig();
      }
    });

    document.getElementById('setting-grain').addEventListener('change', (e) => {
      document.querySelector('.grain-overlay').style.display = e.target.checked ? '' : 'none';
    });

    // Save All
    document.getElementById('edit-save').addEventListener('click', async () => {
      await saveAllContent();
      await saveConfig();
      // Brief visual feedback
      const btn = document.getElementById('edit-save');
      const orig = btn.textContent;
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    // Photo uploads
    document.addEventListener('click', (e) => {
      if (e.target.closest('.photo-delete')) return; // don't trigger upload on delete click
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) {
        const input = zone.querySelector('input[type="file"]');
        if (input) input.click();
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target.matches('.photo-upload-zone input[type="file"]')) {
        uploadPhotos(e.target.dataset.month, e.target.files);
        e.target.value = ''; // reset so same file can be re-uploaded
      }
    });

    // Photo delete
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.photo-delete');
      if (!btn) return;
      e.stopPropagation();
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

    // Audio file upload
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.audio-upload-btn');
      if (btn) {
        const input = btn.parentElement.querySelector('.audio-file-input');
        if (input) input.click();
      }
    });
    document.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('audio-file-input')) return;
      const monthId = e.target.dataset.month;
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('audio', file);
      try {
        const res = await fetch(`/api/debrief/upload-audio/${monthId}`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
          const btn = e.target.parentElement.querySelector('.audio-upload-btn');
          btn.textContent = '✓ ' + data.filename;
          await loadContent();
          mergeData();
        }
      } catch (err) { console.error('Audio upload failed:', err); }
      e.target.value = '';
    });

    // Cover art upload
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.cover-upload-btn');
      if (btn) {
        const input = btn.parentElement.querySelector('.cover-file-input');
        if (input) input.click();
      }
    });
    document.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('cover-file-input')) return;
      const monthId = e.target.dataset.month;
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('cover', file);
      try {
        const res = await fetch(`/api/debrief/upload-cover/${monthId}`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
          const btn = e.target.parentElement.querySelector('.cover-upload-btn');
          btn.textContent = '✓ ' + data.filename;
          await loadContent();
          mergeData();
          // Rebuild the vinyl disc SVG to show new cover
          rebuildVinylDisc(monthId);
        }
      } catch (err) { console.error('Cover upload failed:', err); }
      e.target.value = '';
    });

    // Drag-and-drop
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
    const bgAudioEl = document.getElementById('setting-bg-audio');
    if (monthId && config.months && config.months[monthId]) {
      bgAudioEl.value = config.months[monthId].bgAudioUrl || '';
    } else {
      bgAudioEl.value = '';
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
      if (field === 'reflection') {
        contentData.debrief.reflection = value;
      } else if (field === 'kathrineNote') {
        contentData.debrief.kathrineNote = value;
      } else if (field === 'kathrineQuote') {
        contentData.debrief.kathrineQuote = value;
      } else if (field.startsWith('lesson-')) {
        const idx = parseInt(field.split('-')[1]);
        if (!contentData.debrief.lessons) contentData.debrief.lessons = ['', '', '', '', ''];
        contentData.debrief.lessons[idx] = value;
      } else if (field.startsWith('moment-title-')) {
        const num = field.split('-')[2];
        if (!contentData.debrief.moments) {
          contentData.debrief.moments = DEBRIEF_STATIC.moments.map(m => ({ ...m }));
        }
        const moment = contentData.debrief.moments.find(m => m.number === num);
        if (moment) moment.title = value;
      } else if (field.startsWith('moment-caption-')) {
        const num = field.split('-')[2];
        if (!contentData.debrief.moments) {
          contentData.debrief.moments = DEBRIEF_STATIC.moments.map(m => ({ ...m }));
        }
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

      if (field === 'spotifyTrackId') {
        const embed = el.closest('.slide').querySelector('.spotify-embed');
        if (embed) {
          embed.dataset.trackId = value;
          embed.innerHTML = '';
          loadSpotifyEmbed(el.closest('.slide'));
        }
      }
    }

    await saveAllContent();
  }

  async function saveBgAudioField(el) {
    const monthId = el.dataset.month;
    const value = el.value.trim();
    if (!monthId) return;
    if (!config.months) config.months = {};
    if (!config.months[monthId]) config.months[monthId] = {};
    config.months[monthId].bgAudioUrl = value;
    await saveConfig();
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

  function rebuildVinylDisc(monthId) {
    const m = months.find(x => x.id === monthId);
    if (!m) return;
    const disc = document.getElementById(`disc-${monthId}`);
    if (!disc) return;
    const svg = disc.querySelector('.vinyl-player-svg');
    if (!svg) return;
    // Update the cover image in the SVG
    const existingImg = svg.querySelector('image');
    const existingPlaceholder = svg.querySelectorAll('text');
    if (m.coverFile) {
      if (existingImg) {
        existingImg.setAttribute('href', `/uploads/debrief/covers/${m.coverFile}`);
      } else {
        // Remove placeholder circle and text, add image
        const placeholderCircle = svg.querySelector('circle[r="52"][fill="#1a1a1a"]');
        if (placeholderCircle) placeholderCircle.remove();
        existingPlaceholder.forEach(t => t.remove());
        const ns = 'http://www.w3.org/2000/svg';
        const img = document.createElementNS(ns, 'image');
        img.setAttribute('href', `/uploads/debrief/covers/${m.coverFile}`);
        img.setAttribute('x', '88');
        img.setAttribute('y', '88');
        img.setAttribute('width', '104');
        img.setAttribute('height', '104');
        img.setAttribute('clip-path', `url(#cover-clip-${m.id})`);
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        // Insert before the center hole circle
        const hole = svg.querySelector('circle[r="6"]');
        svg.insertBefore(img, hole);
      }
    }
  }

  // Play/pause button click handler (works for all roles)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.vinyl-play-btn');
    if (!btn) return;
    const monthId = btn.dataset.month;
    const m = months.find(x => x.id === monthId);
    if (!m || !m.audioFile) return;

    const audioUrl = `/uploads/debrief/audio/${m.audioFile}`;
    if (!slideAudio.paused && slideAudio.src.endsWith(m.audioFile)) {
      // Pause
      slideAudio.pause();
      updateDiscSpinState(false);
    } else {
      // Play
      if (!slideAudio.src.endsWith(m.audioFile)) {
        slideAudio.src = audioUrl;
      }
      slideAudio.play().then(() => {
        fadeAudioIn(slideAudio, 0.35, 500);
        updateDiscSpinState(true);
      }).catch(() => {});
    }
  });

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
