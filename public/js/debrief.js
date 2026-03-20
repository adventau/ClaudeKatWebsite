/* ============================================
   debrief.js — Slide Engine, Socket Sync, Edit Mode
   "My Year: A Debrief" by Kaliph
   v2 — Warm theme, event sub-slides, perf fixes
   ============================================ */

(function () {
  'use strict';

  // --- State ---
  let role = null;           // 'presenter' | 'viewer' | 'editor'
  let initDataLoaded = false;
  let slideIndex = 0;
  let revealStep = 0;
  let presenterConnected = false;
  let audioMuted = false;
  let config = {};
  let contentData = {};
  let months = [];           // merged month data
  let debriefData = {};      // merged debrief data
  let transitioning = false;
  let slideList = [];        // flat array of slide descriptors

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
  const addEventBtn = document.getElementById('add-event-btn');

  // --- Helpers ---
  function hexToTint(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function getAudioStartTime(monthId) {
    if (config.months && config.months[monthId] && config.months[monthId].audioStartTime !== undefined) {
      return config.months[monthId].audioStartTime;
    }
    return 0;
  }

  // --- Confirm Modal helper ---
  function showConfirmModal(message, onConfirm) {
    const overlay = document.getElementById('confirm-modal');
    const text = document.getElementById('confirm-modal-text');
    const cancelBtn = document.getElementById('confirm-cancel');
    const deleteBtn = document.getElementById('confirm-delete');
    text.textContent = message;
    overlay.classList.add('visible');

    function cleanup() {
      overlay.classList.remove('visible');
      cancelBtn.removeEventListener('click', handleCancel);
      deleteBtn.removeEventListener('click', handleConfirm);
      overlay.removeEventListener('click', handleOverlay);
      document.removeEventListener('keydown', handleKey);
    }
    function handleCancel() { cleanup(); }
    function handleConfirm() { cleanup(); onConfirm(); }
    function handleOverlay(e) { if (e.target === overlay) cleanup(); }
    function handleKey(e) { if (e.key === 'Escape') cleanup(); }

    cancelBtn.addEventListener('click', handleCancel);
    deleteBtn.addEventListener('click', handleConfirm);
    overlay.addEventListener('click', handleOverlay);
    document.addEventListener('keydown', handleKey);
  }

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
        description: saved.description || m.description,
        songCaption: saved.songCaption || m.songCaption,
        songTitle: saved.songTitle || m.songTitle,
        songArtist: saved.songArtist || m.songArtist,
        spotifyTrackId: saved.spotifyTrackId || m.spotifyTrackId,
        audioFile: saved.audioFile || '',
        coverFile: saved.coverFile || '',
        photos: saved.photos || m.photos,
        photoCaptions: saved.photoCaptions || {},
        events: saved.events || []
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

  // --- Build Slide List (flat array with events interleaved) ---
  function buildSlideList() {
    slideList = [];
    // Intro
    slideList.push({ type: 'intro' });
    // Months + events
    months.forEach((m, mi) => {
      slideList.push({ type: 'month', monthIndex: mi });
      if (m.events && m.events.length) {
        m.events.forEach((evt, ei) => {
          slideList.push({ type: 'event', monthIndex: mi, eventIndex: ei });
        });
      }
    });
    // Debrief
    slideList.push({ type: 'debrief' });
    // Credits
    slideList.push({ type: 'credits' });
  }

  function getTotalSlides() {
    return slideList.length;
  }

  // Find the slide list index for a given month
  function findMonthSlideIndex(monthIndex) {
    return slideList.findIndex(s => s.type === 'month' && s.monthIndex === monthIndex);
  }

  // Get the month data for the current slide (if applicable)
  function getCurrentMonthData() {
    const desc = slideList[slideIndex];
    if (!desc) return null;
    if (desc.type === 'month') return months[desc.monthIndex];
    if (desc.type === 'event') return months[desc.monthIndex];
    return null;
  }

  function getCurrentMonthId() {
    const m = getCurrentMonthData();
    return m ? m.id : null;
  }

  // --- Build Slides ---
  function buildSlides() {
    slidesContainer.innerHTML = '';
    const frag = document.createDocumentFragment();

    slideList.forEach((desc, idx) => {
      let slide;
      switch (desc.type) {
        case 'intro': slide = buildIntroSlide(idx); break;
        case 'month': slide = buildMonthSlide(idx, desc.monthIndex); break;
        case 'event': slide = buildEventSlide(idx, desc.monthIndex, desc.eventIndex); break;
        case 'debrief': slide = buildDebriefSlide(idx); break;
        case 'credits': slide = buildCreditsSlide(idx); break;
      }
      if (slide) frag.appendChild(slide);
    });

    slidesContainer.appendChild(frag);
    buildDotNav();
  }

  function buildIntroSlide(idx) {
    const slide = document.createElement('div');
    slide.className = 'slide slide-intro';
    slide.dataset.slideIndex = String(idx);
    slide.dataset.totalReveals = '0';
    const songName = config.gateSongName || '';
    const nowPlaying = songName ? `<p class="intro-now-playing">Now Playing: ${songName}...</p>` : '';
    slide.innerHTML = `
      <div class="intro-radial-glow"></div>
      <div class="intro-vinyl vinyl-wrap vinyl-spinning"></div>
      <h1 class="intro-title">My Year</h1>
      <p class="intro-subtitle">A Debrief by Kaliph</p>
      <p class="intro-date">September 2024 – December 2025</p>
      ${nowPlaying}
      <span class="intro-vol">Vol. I</span>
    `;
    slide.querySelector('.intro-vinyl').appendChild(createVinyl());
    return slide;
  }

  function buildMonthSlide(idx, monthIndex) {
    const m = months[monthIndex];
    const slide = document.createElement('div');
    slide.className = 'slide slide-month' + (m.darkMode ? ' slide-dark' : '');
    slide.dataset.slideIndex = String(idx);
    slide.dataset.totalReveals = '3';
    slide.dataset.monthId = m.id;
    slide.dataset.monthIndex = String(monthIndex);
    slide.style.setProperty('--accent', m.accentColor);
    if (m.bgGradient) slide.style.background = m.bgGradient;

    slide.innerHTML = `
      <div class="month-left">
        <div class="month-track-label">TRACK ${m.trackNumber}</div>
        <div class="month-year-label">${m.year}</div>
        <div class="month-name">${m.name}</div>
        <div class="reveal-item" data-reveal="1">
          <div class="month-vibe editable" data-field="vibe" data-month="${m.id}">${m.vibe}</div>
        </div>
        <div class="reveal-item" data-reveal="2">
          <div class="month-section-label">ABOUT THIS MONTH</div>
          <div class="month-section-text month-description editable" data-field="description" data-month="${m.id}">${m.description}</div>
        </div>
      </div>
      <div class="month-right">
        ${m.darkMode ? `<div class="month-glow" style="background:radial-gradient(ellipse at 30% 40%, ${m.accentColor}22 0%, transparent 60%)"></div>` : ''}
        <div class="month-right-player-row">
            <div class="vinyl-player" data-month="${m.id}" style="--player-accent:${m.accentColor}">
              <div class="vinyl-player-disc ${m.audioFile ? 'has-audio' : ''}" id="disc-${m.id}">
                <svg class="vinyl-player-svg" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="140" cy="140" r="138" fill="#111" stroke="${m.accentColor}44" stroke-width="1"/>
                  <circle cx="140" cy="140" r="120" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="105" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="90" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
                  <circle cx="140" cy="140" r="75" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
                  <defs>
                    <clipPath id="cover-clip-${m.id}">
                      <circle cx="140" cy="140" r="52"/>
                    </clipPath>
                  </defs>
                  ${m.coverFile
                    ? `<image href="/uploads/debrief/covers/${m.coverFile}" x="88" y="88" width="104" height="104" clip-path="url(#cover-clip-${m.id})" preserveAspectRatio="xMidYMid slice"/>`
                    : `<circle cx="140" cy="140" r="52" fill="#222"/>`
                  }
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
              <div class="vinyl-player-glow" style="background:radial-gradient(circle, ${m.accentColor}12 0%, transparent 70%)"></div>
            </div>
            <div class="song-info">
              <div class="song-now-playing">NOW PLAYING</div>
              <div class="song-title editable" data-field="songTitle" data-month="${m.id}">${m.songTitle}</div>
              <div class="song-artist editable" data-field="songArtist" data-month="${m.id}">${m.songArtist}</div>
              <div class="song-caption editable" data-field="songCaption" data-month="${m.id}">${m.songCaption}</div>
            </div>
          </div>
        <div class="editor-only-fields">
          <div class="editor-upload-row">
            <div class="editor-upload-box">
              <div class="settings-label">Song Audio</div>
              <button class="editor-upload-btn audio-upload-btn ${m.audioFile ? 'has-file' : ''}" data-month="${m.id}">${m.audioFile ? '✓ ' + m.audioFile : '↑ Upload MP3'}</button>
              <input type="file" class="audio-file-input" data-month="${m.id}" accept=".mp3,.m4a,.ogg,.wav,.aac" style="display:none">
              ${m.audioFile ? `
              <div class="audio-trim-row">
                <div class="settings-label">Start At <span class="trim-time-display" id="trim-display-${m.id}">${formatTime(getAudioStartTime(m.id))}</span></div>
                <input type="range" class="audio-trim-slider" id="trim-${m.id}" data-month="${m.id}" min="0" max="300" step="1" value="${getAudioStartTime(m.id)}">
              </div>
              ` : ''}
            </div>
            <div class="editor-upload-box">
              <div class="settings-label">Cover Art</div>
              <button class="editor-upload-btn cover-upload-btn ${m.coverFile ? 'has-file' : ''}" data-month="${m.id}">${m.coverFile ? '✓ ' + m.coverFile : '↑ Upload Image'}</button>
              <input type="file" class="cover-file-input" data-month="${m.id}" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/heic,image/heif" style="display:none">
            </div>
          </div>
        </div>
        <div class="reveal-item" data-reveal="3">
          <div class="photo-filmstrip" id="filmstrip-${m.id}">
            ${buildFilmstrip(m)}
          </div>
          <div class="photo-upload-zone" id="upload-zone-${m.id}">
            <p>Drop photos &amp; videos here or click to upload</p>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm" data-month="${m.id}">
          </div>
        </div>
      </div>
    `;
    return slide;
  }

  function buildEventSlide(idx, monthIndex, eventIndex) {
    const m = months[monthIndex];
    const evt = m.events[eventIndex];
    const slide = document.createElement('div');
    slide.className = 'slide slide-event' + (m.darkMode ? ' slide-dark' : '');
    slide.dataset.slideIndex = String(idx);
    slide.dataset.totalReveals = '0';
    slide.dataset.monthId = m.id;
    slide.dataset.monthIndex = String(monthIndex);
    slide.dataset.eventIndex = String(eventIndex);
    slide.dataset.eventId = evt.id;
    slide.style.setProperty('--accent', m.accentColor);
    if (m.bgGradient) slide.style.background = m.bgGradient;

    const captions = evt.photoCaptions || {};
    const isVideo = (p) => /\.(mp4|mov|webm|m4v|avi)$/i.test(p);
    const photosHtml = (evt.photos && evt.photos.length)
      ? evt.photos.map((p, pi) =>
          `<div class="event-photo-wrapper" draggable="true" data-photo="${p}" data-month="${m.id}" data-event-id="${evt.id}" data-photo-index="${pi}">
            <div class="event-photo-frame event-media-frame" style="position:relative" data-src="/uploads/debrief/${m.id}/${p}" data-type="${isVideo(p) ? 'video' : 'image'}">
              ${isVideo(p)
                ? `<video src="/uploads/debrief/${m.id}/${p}" preload="metadata" muted loop playsinline></video>`
                : `<img src="/uploads/debrief/${m.id}/${p}" alt="" loading="lazy">`
              }
              <button class="photo-delete-event" data-month="${m.id}" data-event-id="${evt.id}" data-filename="${p}">&times;</button>
            </div>
            <div class="event-photo-caption editable" contenteditable="false" data-field="event-photo-caption" data-month="${m.id}" data-event-index="${eventIndex}" data-photo-filename="${p}">${captions[p] || ''}</div>
          </div>`
        ).join('')
      : '';

    slide.innerHTML = `
      <button class="event-delete-btn" data-month-index="${monthIndex}" data-event-index="${eventIndex}">Delete Event</button>
      <div class="event-content">
        <div class="event-text-col">
          <div class="event-breadcrumb">${m.name} ${m.year} · Event</div>
          <div class="event-date editable" data-field="event-date" data-month="${m.id}" data-event-index="${eventIndex}">${evt.date || 'Date'}</div>
          <h2 class="event-title editable" data-field="event-title" data-month="${m.id}" data-event-index="${eventIndex}">${evt.title || 'Untitled Event'}</h2>
          <div class="event-description editable" data-field="event-description" data-month="${m.id}" data-event-index="${eventIndex}">${evt.description || 'Describe what happened...'}</div>
        </div>
        <div class="event-media-col">
          <div class="event-photos" data-month="${m.id}" data-event-id="${evt.id}">${photosHtml}</div>
          <div class="photo-upload-zone" id="upload-zone-evt-${evt.id}">
            <p>Drop photos &amp; videos here or click to upload</p>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm" data-month="${m.id}" data-event-id="${evt.id}">
          </div>
        </div>
      </div>
    `;
    return slide;
  }

  function buildDebriefSlide(idx) {
    const slide = document.createElement('div');
    slide.className = 'slide slide-debrief';
    slide.dataset.slideIndex = String(idx);
    slide.dataset.totalReveals = '5';

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

    slide.innerHTML = `
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
    slide.querySelector('.debrief-vinyl').appendChild(createVinyl());
    slide.querySelector('.debrief-footer-vinyl').appendChild(createVinyl());
    createParticles(slide.querySelector('#debrief-particles'));
    return slide;
  }

  function buildCreditsSlide(idx) {
    const slide = document.createElement('div');
    slide.className = 'slide slide-credits';
    slide.dataset.slideIndex = String(idx);
    slide.dataset.totalReveals = '0';
    slide.innerHTML = `
      <h1 class="credits-title">My Year: A Debrief</h1>
      <p class="credits-by">By Kaliph · 2026</p>
      <p class="credits-presented">Presented to Kathrine</p>
      <p class="credits-her">Her version coming soon.</p>
      <div class="credits-vinyl vinyl-wrap vinyl-spinning"></div>
      <p class="credits-vol">Vol. I · Sep 2024 – Dec 2025</p>
    `;
    slide.querySelector('.credits-vinyl').appendChild(createVinyl());
    return slide;
  }

  function buildFilmstrip(m) {
    if (!m.photos || m.photos.length === 0) {
      return `<div class="filmstrip-placeholder">+</div><div class="filmstrip-placeholder">+</div>`;
    }

    const captions = m.photoCaptions || {};
    const isVid = (p) => /\.(mp4|mov|webm|m4v|avi)$/i.test(p);
    const frameHtml = (p) =>
      `<div class="filmstrip-frame ${isVid(p) ? 'filmstrip-frame--video' : ''}" data-src="/uploads/debrief/${m.id}/${p}" data-type="${isVid(p) ? 'video' : 'image'}" data-month="${m.id}" data-photo-filename="${p}" data-caption="${(captions[p] || '').replace(/"/g, '&quot;')}">
        ${isVid(p)
          ? `<video src="/uploads/debrief/${m.id}/${p}" preload="metadata" muted loop playsinline></video>`
          : `<img src="/uploads/debrief/${m.id}/${p}" alt="Photo" loading="lazy">`}
        <button class="photo-delete" data-month="${m.id}" data-filename="${p}">&times;</button>
      </div>`;

    // If 3+ photos and not in editor mode, use infinite marquee
    if (m.photos.length >= 3 && role !== 'editor') {
      // Duplicate photos for seamless loop — speed scales with count
      const duration = Math.max(12, m.photos.length * 4);
      const track = m.photos.map(frameHtml).join('');
      return `<div class="filmstrip-marquee-track" style="--marquee-duration:${duration}s">${track}${track}</div>`;
    }

    return m.photos.map(frameHtml).join('');
  }

  function createParticles(container) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'debrief-particle';
      const size = 1 + Math.random() * 2;
      p.style.cssText = `
        width:${size}px; height:${size}px;
        left:${Math.random() * 100}%; top:${Math.random() * 100}%;
        opacity:${0.05 + Math.random() * 0.1};
        animation-duration:${18 + Math.random() * 24}s;
        animation-delay:${-Math.random() * 20}s;
      `;
      container.appendChild(p);
    }
  }

  function buildDotNav() {
    dotNav.innerHTML = '';
    const total = getTotalSlides();
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot-nav-item';
      if (slideList[i].type === 'event') dot.classList.add('dot-event');
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
    let accent = 'var(--accent-gold)';
    const desc = slideList[slideIndex];
    if (desc && (desc.type === 'month' || desc.type === 'event')) {
      accent = months[desc.monthIndex].accentColor;
    }
    dotNav.style.setProperty('--nav-accent', accent);
    dots.forEach((d, i) => d.classList.toggle('active', i === slideIndex));
  }

  // --- Slide Navigation ---
  function navigateToSlide(newIndex, direction) {
    const total = getTotalSlides();
    if (newIndex < 0 || newIndex >= total || newIndex === slideIndex) return;
    if (transitioning) return;

    const slides = slidesContainer.querySelectorAll('.slide');
    if (!slides.length) return;
    const oldSlide = slides[slideIndex];
    const newSlide = slides[newIndex];
    if (!oldSlide || !newSlide) return;

    const goForward = direction !== undefined ? direction === 'forward' : newIndex > slideIndex;
    transitioning = true;

    // Clean ALL animation classes from ALL slides
    slides.forEach(s => {
      s.classList.remove('slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
    });

    // Force reflow
    void newSlide.offsetWidth;

    newSlide.classList.add('active');

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

    // Use animationend for cleanup instead of setTimeout
    function onAnimEnd(e) {
      if (e.target !== newSlide) return;
      newSlide.removeEventListener('animationend', onAnimEnd);
      oldSlide.classList.remove('active', 'slide-exit-left', 'slide-exit-right');
      newSlide.classList.remove('slide-enter-right', 'slide-enter-left');
      transitioning = false;
    }
    newSlide.addEventListener('animationend', onAnimEnd);

    // Fallback in case animationend doesn't fire
    setTimeout(() => {
      if (transitioning) {
        oldSlide.classList.remove('active', 'slide-exit-left', 'slide-exit-right');
        newSlide.classList.remove('slide-enter-right', 'slide-enter-left');
        transitioning = false;
      }
    }, 800);

    // Editor: reveal everything
    if (role === 'editor') {
      const total = parseInt(newSlide.dataset.totalReveals || '0');
      revealStep = total;
      revealAllItems(newSlide);
    }

    updateUI();
    updateSlideAudio();
    updateSlideVideos();
    sizeAllEventImages();
    eagerLoadSlide(newSlide);
  }

  function jumpToSlide(idx) {
    const slides = slidesContainer.querySelectorAll('.slide');
    slides.forEach(s => {
      s.classList.remove('active', 'slide-enter-right', 'slide-exit-left', 'slide-enter-left', 'slide-exit-right');
    });
    slideIndex = idx;
    const slide = slides[idx];
    if (slide) {
      slide.classList.add('active');
      if (role === 'editor') {
        const total = parseInt(slide.dataset.totalReveals || '0');
        revealStep = total;
        revealAllItems(slide);
      }
    }
    updateUI();
    updateSlideAudio();
    updateSlideVideos();
    sizeAllEventImages();
    eagerLoadSlide(slide);
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
    if (!slide) return;
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
    updateRevealCounter(slide);
  }

  function updateUI() {
    const total = getTotalSlides();
    slideCounter.textContent = `${String(slideIndex + 1).padStart(2, '0')} / ${total}`;
    updateDotNav();
    const slides = slidesContainer.querySelectorAll('.slide');
    updateRevealCounter(slides[slideIndex]);

    // Update "Add Event" button visibility
    if (role === 'editor' && addEventBtn) {
      const desc = slideList[slideIndex];
      const isMonth = desc && desc.type === 'month';
      const isEvent = desc && desc.type === 'event';
      addEventBtn.classList.toggle('visible', isMonth || isEvent);
    }

    // Update editor toolbar label
    if (role === 'editor') {
      const label = document.getElementById('edit-slide-label');
      if (label) {
        const desc = slideList[slideIndex];
        let name = `Slide ${slideIndex + 1}`;
        if (desc) {
          if (desc.type === 'intro') name = 'Intro';
          else if (desc.type === 'month') name = months[desc.monthIndex].name + ' ' + months[desc.monthIndex].year;
          else if (desc.type === 'event') {
            const m = months[desc.monthIndex];
            const evt = m.events[desc.eventIndex];
            name = m.name + ' · ' + (evt.title || 'Event');
          }
          else if (desc.type === 'debrief') name = 'The Debrief';
          else if (desc.type === 'credits') name = 'Credits';
        }
        label.textContent = `${name} · ${slideIndex + 1}/${total}`;
      }
    }
  }

  function updateRevealCounter(slide) {
    if (!slide) return;
    const total = parseInt(slide.dataset.totalReveals || '0');
    revealCounter.textContent = total > 0 ? `Step ${revealStep} / ${total}` : '';
  }

  // --- Audio System ---
  let audioUnlocked = false;
  let gateAudioReady = false;

  function initGateAudio() {
    const src = config.gateSongFile
      ? `/uploads/debrief/audio/${config.gateSongFile}`
      : config.gateSongUrl || '';
    if (!src) return;
    gateAudio.src = src;
    gateAudio.volume = 0;
    gateAudio.muted = true;
    gateAudio.load(); // Preload the audio
    gateAudioReady = true;

    // Try autoplay — most browsers will block this
    const playPromise = gateAudio.play();
    if (playPromise) {
      playPromise.then(() => {
        audioUnlocked = true;
        gateAudio.muted = false;
        fadeAudioIn(gateAudio, config.globalVolume || 0.4, 2000);
        removeUnlockListeners();
      }).catch(() => {
        // Autoplay blocked — we'll start on first user interaction
        gateAudio.pause();
        gateAudio.currentTime = 0;
      });
    }
  }

  function removeUnlockListeners() {
    document.removeEventListener('click', unlockAudio, true);
    document.removeEventListener('keydown', unlockAudio, true);
    document.removeEventListener('touchstart', unlockAudio, true);
    document.removeEventListener('mousedown', unlockAudio, true);
    gatePassword.removeEventListener('input', unlockAudio);
    gatePassword.removeEventListener('focus', unlockAudio);
    audioPrompt.classList.remove('visible');
  }

  // Unlock audio on ANY user interaction — uses capture phase to fire first
  function unlockAudio() {
    if (audioUnlocked) return;
    // If audio src isn't loaded yet, don't consume — keep listening
    if (!gateAudioReady) return;
    audioUnlocked = true;
    removeUnlockListeners();

    gateAudio.muted = false;
    gateAudio.volume = 0;
    gateAudio.play().then(() => {
      fadeAudioIn(gateAudio, config.globalVolume || 0.4, 1500);
    }).catch(() => {
      // Retry on next interaction if this one failed
      audioUnlocked = false;
      addUnlockListeners();
    });
  }

  function addUnlockListeners() {
    // Use capture phase so these fire BEFORE any other handlers
    document.addEventListener('click', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);
    document.addEventListener('touchstart', unlockAudio, true);
    document.addEventListener('mousedown', unlockAudio, true);
    // Also listen directly on the password input
    gatePassword.addEventListener('input', unlockAudio);
    gatePassword.addEventListener('focus', unlockAudio);
  }
  addUnlockListeners();

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

  function updateSlideVideos() {
    const slides = slidesContainer.querySelectorAll('.slide');
    slides.forEach((s, i) => {
      // Covers both event-photo-frame videos AND filmstrip videos
      s.querySelectorAll('.event-photo-frame video, .filmstrip-frame video').forEach(v => {
        if (i === slideIndex) {
          v.muted = true;
          v.play().catch(() => {});
        } else {
          v.pause();
          v.currentTime = 0;
        }
      });
    });
  }

  // Set aspect-ratio on event image frames so the full photo shows (all roles).
  // Called for both freshly-loaded and already-cached images.
  function sizeEventFrame(img) {
    const frame = img.closest('.event-media-frame[data-type="image"]');
    if (!frame || !img.naturalWidth || !img.naturalHeight) return;
    frame.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  }
  document.addEventListener('load', (e) => {
    if (e.target.tagName === 'IMG') sizeEventFrame(e.target);
  }, true);
  // Handle images already in cache (complete before listener fires)
  function sizeAllEventImages() {
    document.querySelectorAll('.event-media-frame[data-type="image"] img').forEach(img => {
      if (img.complete && img.naturalWidth) sizeEventFrame(img);
    });
  }

  // Size FILMSTRIP video frames to natural aspect ratio on metadata load.
  // (Event slide frames are handled by CSS grid — no JS sizing needed there.)
  document.addEventListener('loadedmetadata', (e) => {
    const v = e.target;
    if (v.tagName !== 'VIDEO') return;
    if (!v.videoWidth || !v.videoHeight) return;
    const ratio = v.videoWidth / v.videoHeight;

    // Filmstrip video frame
    const filmFrame = v.closest('.filmstrip-frame--video');
    if (filmFrame) {
      const maxH = 150, maxW = 260;
      const h = Math.min(maxH, v.videoHeight);
      const w = Math.min(maxW, Math.round(ratio * h));
      filmFrame.style.height = h + 'px';
      filmFrame.style.width  = w + 'px';
    }
  }, true);

  // Preload audio files for the first N months using <link rel="preload">
  // so they're in the browser cache before the user navigates to those slides
  function preloadAudioFiles() {
    let count = 0;
    for (const m of months) {
      if (!m.audioFile || count >= 3) break;
      const existing = document.head.querySelector(`link[data-debrief-audio="${m.audioFile}"]`);
      if (existing) continue;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'audio';
      link.href = `/uploads/debrief/audio/${m.audioFile}`;
      link.dataset.debriefAudio = m.audioFile;
      document.head.appendChild(link);
      count++;
    }
  }

  // Strip lazy loading from images on the active slide so they load immediately
  function eagerLoadSlide(slide) {
    if (!slide) return;
    slide.querySelectorAll('img[loading="lazy"]').forEach(img => {
      img.removeAttribute('loading');
    });
  }

  function updateSlideAudio() {
    const desc = slideList[slideIndex];
    let bgUrl = '';
    let monthData = null;

    if (desc && (desc.type === 'month' || desc.type === 'event')) {
      monthData = months[desc.monthIndex];
      if (monthData && monthData.audioFile) {
        bgUrl = `/uploads/debrief/audio/${monthData.audioFile}`;
      }
    }

    // Fade out gate audio when leaving intro to any other slide
    if (desc && desc.type !== 'intro' && !gateAudio.paused) {
      fadeAudioOut(gateAudio, 600);
    }

    if (!bgUrl) {
      // Instantly stop
      slideAudio.pause();
      slideAudio.currentTime = 0;
      slideAudio.volume = 0;
      updateDiscSpinState(false);
      return;
    }

    const isSameSong = slideAudio.src && slideAudio.src.endsWith(bgUrl.split('/').pop());

    // For event sub-slides of the same month, keep playing
    if (isSameSong && !slideAudio.paused) return;

    // Instantly stop previous audio
    slideAudio.pause();
    slideAudio.currentTime = 0;
    slideAudio.volume = 0;

    // Load and play new audio from the saved start time
    slideAudio.src = bgUrl;
    const startTime = monthData ? getAudioStartTime(monthData.id) : 0;
    slideAudio.currentTime = startTime;
    slideAudio.volume = audioMuted ? 0 : 0.35;
    slideAudio.play().then(() => {
      if (!audioMuted) fadeAudioIn(slideAudio, masterVolume, 400);
      updateDiscSpinState(true);
    }).catch(() => {
      updateDiscSpinState(false);
    });
  }

  function updateDiscSpinState(playing) {
    const desc = slideList[slideIndex];
    if (!desc || desc.type !== 'month') return;
    const monthId = months[desc.monthIndex].id;
    const disc = document.getElementById(`disc-${monthId}`);
    if (disc) {
      disc.classList.toggle('spinning', playing);
    }
    const btn = disc && disc.querySelector('.vinyl-play-btn');
    if (btn) {
      btn.querySelector('.play-icon').style.display = playing ? 'none' : 'block';
      btn.querySelector('.pause-icon').style.display = playing ? 'block' : 'none';
    }
  }

  // --- Volume control ---
  const volumeSlider = document.getElementById('volume-slider');
  const volumePct    = document.getElementById('volume-pct');
  let masterVolume   = config.globalVolume || 0.4; // 0–1

  function applyMasterVolume(vol) {
    masterVolume = Math.max(0, Math.min(1, vol));
    volumeSlider.value = Math.round(masterVolume * 100);
    volumePct.textContent = Math.round(masterVolume * 100) + '%';
    if (!audioMuted) {
      if (!gateAudio.paused)  gateAudio.volume  = masterVolume;
      if (!slideAudio.paused) slideAudio.volume = masterVolume;
    }
    // Update icon — show muted icon when vol is 0
    const isSilent = masterVolume === 0;
    audioIconOn.style.display  = isSilent ? 'none'  : 'block';
    audioIconOff.style.display = isSilent ? 'block' : 'none';
  }

  volumeSlider.addEventListener('input', () => {
    if (role !== 'presenter' && role !== 'editor') return;
    const vol = parseInt(volumeSlider.value) / 100;
    applyMasterVolume(vol);
    socket.emit('debrief:volume-change', { volume: vol });
  });

  // Viewer receives volume from presenter
  socket.on('debrief:volume-change', (data) => {
    if (role === 'viewer') applyMasterVolume(data.volume);
  });

  audioToggle.addEventListener('click', () => {
    audioMuted = !audioMuted;
    audioIconOn.style.display = (audioMuted || masterVolume === 0) ? 'none' : 'block';
    audioIconOff.style.display = (audioMuted || masterVolume === 0) ? 'block' : 'none';

    [gateAudio, slideAudio].forEach(a => {
      if (audioMuted) { a.volume = 0; }
      else if (!a.paused) {
        fadeAudioIn(a, masterVolume, 500);
      }
    });
  });

  // Only show volume slider for presenter/editor (hidden for viewers)
  function updateVolumeVisibility() {
    const wrap = document.getElementById('audio-control-wrap');
    const popup = document.getElementById('volume-popup');
    if (role === 'presenter' || role === 'editor') {
      popup.style.display = '';
    } else {
      popup.style.display = 'none';
    }
  }

  // --- Gate Screen ---
  gateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockAudio(); // User interaction — unlock audio now
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
        if (!initDataLoaded) {
          await Promise.all([loadContent(), loadConfig()]);
          mergeData();
          buildSlideList();
        }
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
    // Don't stop gate audio — it continues as the intro music
    gateScreen.classList.add('hidden');
    setTimeout(() => { gateScreen.style.display = 'none'; }, 600);
    presentation.classList.add('active');

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

    buildSlides();
    jumpToSlide(0);
    updateVolumeVisibility();
    applyMasterVolume(config.globalVolume || 0.4);
    preloadAudioFiles(); // warm browser cache for first few months' audio
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
      updateSlideAudio();
    }
  });

  // --- Event Sub-Slides ---
  function addEventSlide() {
    const desc = slideList[slideIndex];
    if (!desc) return;

    let monthIndex;
    if (desc.type === 'month') monthIndex = desc.monthIndex;
    else if (desc.type === 'event') monthIndex = desc.monthIndex;
    else return;

    const m = months[monthIndex];
    const newEvt = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: 'New Event',
      date: '',
      description: '',
      photos: []
    };

    if (!m.events) m.events = [];
    m.events.push(newEvt);

    // Save to contentData
    if (!contentData.months) contentData.months = {};
    if (!contentData.months[m.id]) contentData.months[m.id] = {};
    contentData.months[m.id].events = m.events;

    saveAllContent().then(() => {
      // Rebuild
      buildSlideList();
      buildSlides();
      // Navigate to the new event slide
      const newIdx = slideList.findIndex(s => s.type === 'event' && s.monthIndex === monthIndex && s.eventIndex === m.events.length - 1);
      if (newIdx >= 0) jumpToSlide(newIdx);
      else jumpToSlide(slideIndex);
    });
  }

  function deleteEventSlide(monthIndex, eventIndex) {
    const m = months[monthIndex];
    if (!m.events || !m.events[eventIndex]) return;

    m.events.splice(eventIndex, 1);

    if (!contentData.months) contentData.months = {};
    if (!contentData.months[m.id]) contentData.months[m.id] = {};
    contentData.months[m.id].events = m.events;

    saveAllContent().then(() => {
      buildSlideList();
      buildSlides();
      // Go to the parent month slide
      const monthIdx = findMonthSlideIndex(monthIndex);
      jumpToSlide(monthIdx >= 0 ? monthIdx : 0);
    });
  }

  // Add event button
  if (addEventBtn) {
    addEventBtn.addEventListener('click', addEventSlide);
  }

  // --- Shared save ---
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

  // --- Editor Mode ---
  function initEditorMode() {
    // Use event delegation on document for all editor interactions

    // Click to edit .editable
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

    // Paste image from clipboard → upload to current slide
    document.addEventListener('paste', async (e) => {
      if (role !== 'editor') return;
      // Don't intercept pastes inside text fields
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(it => it.type.startsWith('image/'));
      if (!imageItems.length) return;
      e.preventDefault();

      const files = imageItems.map(it => {
        const blob = it.getAsFile();
        // Give it a sensible filename with timestamp
        return new File([blob], `paste-${Date.now()}.${it.type.split('/')[1] || 'png'}`, { type: it.type });
      });

      const desc = slideList[slideIndex];
      if (!desc) return;

      // Show a brief toast so the user knows it worked
      showPasteToast();

      if (desc.type === 'event') {
        const m = months[desc.monthIndex];
        const evt = m?.events?.[desc.eventIndex];
        if (m && evt) await uploadEventPhotos(m.id, evt.id, files);
      } else if (desc.type === 'month') {
        const m = months[desc.monthIndex];
        if (m) await uploadPhotos(m.id, files);
      }
    });

    function showPasteToast() {
      let toast = document.getElementById('debrief-paste-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'debrief-paste-toast';
        toast.textContent = '📋 Uploading pasted image…';
        document.body.appendChild(toast);
      }
      toast.classList.add('visible');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // Rich text: Cmd/Ctrl + B, I, U
    document.addEventListener('keydown', (e) => {
      if (role !== 'editor') return;
      const el = document.activeElement?.closest?.('.editable');
      if (!el || !el.isContentEditable) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); document.execCommand('bold'); }
      else if (key === 'i') { e.preventDefault(); document.execCommand('italic'); }
      else if (key === 'u') { e.preventDefault(); document.execCommand('underline'); }
    });

    // Settings drawer
    document.getElementById('edit-settings-btn').addEventListener('click', () => {
      settingsDrawer.classList.toggle('open');
      if (settingsDrawer.classList.contains('open')) populateSettings();
    });

    document.getElementById('setting-gate-song-name').addEventListener('change', async (e) => {
      config.gateSongName = e.target.value;
      await saveConfig();
    });

    document.getElementById('setting-gate-song-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('gate-song-status');
      status.textContent = 'Uploading...';
      const form = new FormData();
      form.append('audio', file);
      try {
        const res = await fetch('/api/debrief/upload-gate-audio', { method: 'POST', body: form });
        const data = await res.json();
        if (data.ok) {
          config.gateSongFile = data.filename;
          await saveConfig();
          status.textContent = 'Uploaded: ' + file.name;
        } else {
          status.textContent = 'Error: ' + (data.error || 'Upload failed');
        }
      } catch (err) {
        status.textContent = 'Upload failed';
      }
    });

    document.getElementById('setting-grain').addEventListener('change', (e) => {
      document.querySelector('.grain-overlay').style.display = e.target.checked ? '' : 'none';
    });

    // Save All
    document.getElementById('edit-save').addEventListener('click', async () => {
      await saveAllContent();
      await saveConfig();
      const btn = document.getElementById('edit-save');
      const orig = btn.textContent;
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    // Photo uploads (delegated)
    document.addEventListener('click', (e) => {
      if (e.target.closest('.photo-delete')) return;
      if (e.target.closest('.event-delete-btn')) return;
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) {
        const input = zone.querySelector('input[type="file"]');
        if (input) input.click();
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target.matches('.photo-upload-zone input[type="file"]')) {
        const monthId = e.target.dataset.month;
        const eventId = e.target.dataset.eventId;
        if (eventId) {
          uploadEventPhotos(monthId, eventId, e.target.files);
        } else {
          uploadPhotos(monthId, e.target.files);
        }
        e.target.value = '';
      }
    });

    // Drag-and-drop support for upload zones (also prevents browser navigation on bad drops)
    document.addEventListener('dragover', (e) => {
      if (e.target.closest('.photo-upload-zone')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        e.target.closest('.photo-upload-zone').classList.add('drag-active');
      }
    });
    document.addEventListener('dragleave', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag-active');
    });
    document.addEventListener('drop', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('drag-active');
      const input = zone.querySelector('input[type="file"]');
      if (!input) return;
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      const monthId = input.dataset.month;
      const eventId = input.dataset.eventId;
      if (eventId) uploadEventPhotos(monthId, eventId, files);
      else uploadPhotos(monthId, files);
    });

    // Prevent browser file-navigation when dropping outside a zone
    window.addEventListener('dragover', (e) => {
      if (!e.target.closest('.photo-upload-zone') && !e.target.closest('.event-photo-wrapper')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!e.target.closest('.photo-upload-zone') && !e.target.closest('.event-photo-wrapper')) e.preventDefault();
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

    // Event delete — custom modal instead of browser confirm()
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.event-delete-btn');
      if (!btn || role !== 'editor') return;
      e.stopPropagation();
      const mi = parseInt(btn.dataset.monthIndex);
      const ei = parseInt(btn.dataset.eventIndex);
      showConfirmModal('Delete this event slide?', () => {
        deleteEventSlide(mi, ei);
      });
    });

    // Audio file upload
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.audio-upload-btn');
      if (!btn || role !== 'editor') return;
      e.preventDefault();
      e.stopPropagation();
      const box = btn.closest('.editor-upload-box');
      const input = box ? box.querySelector('.audio-file-input') : null;
      if (input) input.click();
    });
    document.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('audio-file-input')) return;
      const monthId = e.target.dataset.month;
      const file = e.target.files[0];
      if (!file) return;
      const box = e.target.closest('.editor-upload-box');
      const btn = box ? box.querySelector('.audio-upload-btn') : null;
      if (btn) { btn.textContent = 'Uploading...'; btn.style.opacity = '0.5'; }
      const formData = new FormData();
      formData.append('audio', file);
      try {
        const res = await fetch(`/api/debrief/upload-audio/${monthId}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();
        if (data.ok) {
          if (btn) { btn.textContent = '✓ ' + data.filename; btn.classList.add('has-file'); btn.style.opacity = '1'; }
          await loadContent();
          mergeData();
          // Force the audio player to reload with the new file immediately
          slideAudio.pause();
          slideAudio.src = '';
          updateSlideAudio();
          // Rebuild current slide so trim slider reflects new filename
          buildSlides();
          jumpToSlide(slideIndex);
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      } catch (err) {
        console.error('Audio upload failed:', err);
        if (btn) { btn.textContent = '✗ Error — try again'; btn.style.opacity = '1'; }
      }
      e.target.value = '';
    });

    // Audio trim slider — updates display and seeks audio to preview the start position
    document.addEventListener('input', (e) => {
      if (!e.target.classList.contains('audio-trim-slider')) return;
      const monthId = e.target.dataset.month;
      const val = parseInt(e.target.value);
      const display = document.getElementById(`trim-display-${monthId}`);
      if (display) display.textContent = formatTime(val);

      // Seek audio to this position so the user can hear it
      const m = months.find(x => x.id === monthId);
      if (m && m.audioFile) {
        const audioUrl = `/uploads/debrief/audio/${m.audioFile}`;
        if (!slideAudio.src || !slideAudio.src.endsWith(m.audioFile)) {
          slideAudio.src = audioUrl;
        }
        slideAudio.currentTime = val;
        if (slideAudio.paused) {
          slideAudio.volume = audioMuted ? 0 : 0.35;
          slideAudio.play().then(() => {
            updateDiscSpinState(true);
          }).catch(() => {});
        }
      }
    });
    document.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('audio-trim-slider')) return;
      const monthId = e.target.dataset.month;
      const val = parseInt(e.target.value);
      if (!config.months) config.months = {};
      if (!config.months[monthId]) config.months[monthId] = {};
      config.months[monthId].audioStartTime = val;
      await saveConfig();
    });

    // Trim slider: update max duration when audio metadata loads
    document.addEventListener('click', (e) => {
      const slider = e.target.closest('.audio-trim-slider');
      if (!slider) return;
      const monthId = slider.dataset.month;
      const m = months.find(x => x.id === monthId);
      if (!m || !m.audioFile) return;
      // Load audio to get duration
      const tempAudio = new Audio(`/uploads/debrief/audio/${m.audioFile}`);
      tempAudio.addEventListener('loadedmetadata', () => {
        slider.max = Math.floor(tempAudio.duration);
      });
    });

    // Cover art upload
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.cover-upload-btn');
      if (!btn || role !== 'editor') return;
      e.preventDefault();
      e.stopPropagation();
      const box = btn.closest('.editor-upload-box');
      const input = box ? box.querySelector('.cover-file-input') : null;
      if (input) input.click();
    });
    document.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('cover-file-input')) return;
      const monthId = e.target.dataset.month;
      const file = e.target.files[0];
      if (!file) return;
      const box = e.target.closest('.editor-upload-box');
      const btn = box ? box.querySelector('.cover-upload-btn') : null;
      if (btn) { btn.textContent = 'Uploading...'; btn.style.opacity = '0.5'; }
      const formData = new FormData();
      formData.append('cover', file);
      try {
        const res = await fetch(`/api/debrief/upload-cover/${monthId}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();
        if (data.ok) {
          if (btn) { btn.textContent = '✓ ' + data.filename; btn.classList.add('has-file'); btn.style.opacity = '1'; }
          await loadContent();
          mergeData();
          rebuildVinylDisc(monthId);
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      } catch (err) {
        console.error('Cover upload failed:', err);
        if (btn) { btn.textContent = '✗ Error — try again'; btn.style.opacity = '1'; }
      }
      e.target.value = '';
    });

    // Drag-and-drop for file uploads onto zones
    document.addEventListener('dragover', (e) => {
      const zone = e.target.closest('.photo-upload-zone');
      if (zone) { e.preventDefault(); zone.style.borderColor = 'var(--accent-gold)'; }
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
      const input = zone.querySelector('input[type="file"]');
      const monthId = input.dataset.month;
      const eventId = input.dataset.eventId;
      if (eventId) {
        uploadEventPhotos(monthId, eventId, e.dataTransfer.files);
      } else {
        uploadPhotos(monthId, e.dataTransfer.files);
      }
    });

    // --- Photo reorder within event slides ---
    let dragSrcWrapper = null;

    // Prevent native image drag from hijacking our custom drag
    document.addEventListener('dragstart', (e) => {
      if (e.target.tagName === 'IMG' && e.target.closest('.event-photo-wrapper')) {
        // Let it bubble to the wrapper's handler but set the drag data from the wrapper
        const wrapper = e.target.closest('.event-photo-wrapper');
        if (!wrapper || role !== 'editor') return;
        dragSrcWrapper = wrapper;
        wrapper.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', wrapper.dataset.photoIndex);
        // Set a small drag image
        e.dataTransfer.setDragImage(wrapper, wrapper.offsetWidth / 2, wrapper.offsetHeight / 2);
        return;
      }
      const wrapper = e.target.closest('.event-photo-wrapper');
      if (!wrapper || role !== 'editor') return;
      dragSrcWrapper = wrapper;
      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', wrapper.dataset.photoIndex);
    }, true);

    document.addEventListener('dragover', (e) => {
      if (!dragSrcWrapper) return;
      const wrapper = e.target.closest('.event-photo-wrapper');
      if (!wrapper || wrapper === dragSrcWrapper) {
        // Still need to allow drop on event-photos container area
        if (dragSrcWrapper) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
        return;
      }
      // Only allow reorder within same event
      if (wrapper.dataset.eventId !== dragSrcWrapper.dataset.eventId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Show drop indicator
      const rect = wrapper.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        wrapper.style.transform = 'translateX(8px)';
        wrapper.dataset.dropSide = 'before';
      } else {
        wrapper.style.transform = 'translateX(-8px)';
        wrapper.dataset.dropSide = 'after';
      }
    }, true);

    document.addEventListener('dragleave', (e) => {
      const wrapper = e.target.closest('.event-photo-wrapper');
      if (wrapper && wrapper !== dragSrcWrapper) {
        wrapper.style.transform = '';
        delete wrapper.dataset.dropSide;
      }
    }, true);

    document.addEventListener('drop', (e) => {
      if (!dragSrcWrapper) return;
      const wrapper = e.target.closest('.event-photo-wrapper');
      if (!wrapper || wrapper === dragSrcWrapper) {
        // Not dropping on a different photo — clean up
        if (dragSrcWrapper) {
          dragSrcWrapper.classList.remove('dragging');
          dragSrcWrapper = null;
        }
        return;
      }
      if (wrapper.dataset.eventId !== dragSrcWrapper.dataset.eventId) return;
      e.preventDefault();
      e.stopPropagation();

      const monthId = wrapper.dataset.month;
      const eventId = wrapper.dataset.eventId;
      const fromIdx = parseInt(dragSrcWrapper.dataset.photoIndex);
      let toIdx = parseInt(wrapper.dataset.photoIndex);
      const dropSide = wrapper.dataset.dropSide || 'after';

      // Clean up styles
      wrapper.style.transform = '';
      delete wrapper.dataset.dropSide;
      dragSrcWrapper.classList.remove('dragging');
      dragSrcWrapper = null;

      reorderEventPhoto(monthId, eventId, fromIdx, toIdx, dropSide);
    }, true);

    document.addEventListener('dragend', (e) => {
      if (dragSrcWrapper) {
        dragSrcWrapper.classList.remove('dragging');
        dragSrcWrapper = null;
      }
      // Clean up any leftover transforms
      document.querySelectorAll('.event-photo-wrapper').forEach(w => {
        w.style.transform = '';
        delete w.dataset.dropSide;
      });
    });

    // Event photo delete
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.photo-delete-event');
      if (!btn || role !== 'editor') return;
      e.stopPropagation();
      const monthId = btn.dataset.month;
      const eventId = btn.dataset.eventId;
      const filename = btn.dataset.filename;
      // Remove from event data
      const m = months.find(x => x.id === monthId);
      if (!m) return;
      const evt = m.events.find(ev => ev.id === eventId);
      if (!evt || !evt.photos) return;
      evt.photos = evt.photos.filter(p => p !== filename);
      if (!contentData.months) contentData.months = {};
      if (!contentData.months[monthId]) contentData.months[monthId] = {};
      if (!contentData.months[monthId].events) contentData.months[monthId].events = [];
      const savedEvt = contentData.months[monthId].events.find(ev => ev.id === eventId);
      if (savedEvt) savedEvt.photos = evt.photos;
      await saveAllContent();
      buildSlideList();
      buildSlides();
      jumpToSlide(slideIndex);
    });
  }

  function populateSettings() {
    document.getElementById('setting-gate-song-name').value = config.gateSongName || '';
    const status = document.getElementById('gate-song-status');
    status.textContent = config.gateSongFile ? 'Current: ' + config.gateSongFile : '';
  }

  async function saveField(el) {
    const field = el.dataset.field;
    const monthId = el.dataset.month;
    const isDebrief = el.dataset.debrief === 'true';
    const eventIndex = el.dataset.eventIndex;
    const value = el.innerHTML.trim();

    if (monthId && eventIndex !== undefined && eventIndex !== null) {
      // Event field
      const ei = parseInt(eventIndex);
      if (!contentData.months) contentData.months = {};
      if (!contentData.months[monthId]) contentData.months[monthId] = {};
      if (!contentData.months[monthId].events) contentData.months[monthId].events = [];
      const evt = contentData.months[monthId].events[ei];
      if (evt) {
        if (field === 'event-title') evt.title = value;
        else if (field === 'event-date') evt.date = value;
        else if (field === 'event-description') evt.description = value;
        else if (field === 'event-photo-caption') {
          const photoFilename = el.dataset.photoFilename;
          if (photoFilename) {
            if (!evt.photoCaptions) evt.photoCaptions = {};
            evt.photoCaptions[photoFilename] = value;
          }
        }
      }
      // Also update in-memory
      const m = months.find(x => x.id === monthId);
      if (m && m.events[ei]) {
        if (field === 'event-title') m.events[ei].title = value;
        else if (field === 'event-date') m.events[ei].date = value;
        else if (field === 'event-description') m.events[ei].description = value;
        else if (field === 'event-photo-caption') {
          const photoFilename = el.dataset.photoFilename;
          if (photoFilename) {
            if (!m.events[ei].photoCaptions) m.events[ei].photoCaptions = {};
            m.events[ei].photoCaptions[photoFilename] = value;
          }
        }
      }
    } else if (monthId) {
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
      await fetch(`/api/debrief/upload/${monthId}`, { method: 'POST', body: formData });
      await loadContent();
      mergeData();
      refreshFilmstrip(monthId);
    } catch (e) {
      console.error('Upload failed:', e);
    }
  }

  async function uploadEventPhotos(monthId, eventId, files) {
    if (!files || !files.length) return;
    const targetIdx = slideIndex; // capture before any awaits
    const formData = new FormData();
    for (const f of files) formData.append('photos', f);
    try {
      const res = await fetch(`/api/debrief/upload/${monthId}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.ok && data.files) {
        // Add photo filenames to the event
        if (!contentData.months) contentData.months = {};
        if (!contentData.months[monthId]) contentData.months[monthId] = {};
        if (!contentData.months[monthId].events) contentData.months[monthId].events = [];
        const evt = contentData.months[monthId].events.find(e => e.id === eventId);
        if (evt) {
          if (!evt.photos) evt.photos = [];
          evt.photos.push(...data.files);
          await saveAllContent();
          await loadContent();
          mergeData();
          // Rebuild the event slide and return to the same slide
          buildSlideList();
          buildSlides();
          jumpToSlide(targetIdx);
        }
      }
    } catch (e) {
      console.error('Event photo upload failed:', e);
    }
  }

  function rebuildVinylDisc(monthId) {
    const m = months.find(x => x.id === monthId);
    if (!m) return;
    const disc = document.getElementById(`disc-${monthId}`);
    if (!disc) return;
    const svg = disc.querySelector('.vinyl-player-svg');
    if (!svg) return;
    const existingImg = svg.querySelector('image');
    const existingPlaceholder = svg.querySelectorAll('text');
    if (m.coverFile) {
      if (existingImg) {
        existingImg.setAttribute('href', `/uploads/debrief/covers/${m.coverFile}`);
      } else {
        const placeholderCircle = svg.querySelector('circle[r="52"][fill="#222"]');
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
        svg.appendChild(img);
      }
    }
  }

  // Play/pause button click handler
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.vinyl-play-btn');
    if (!btn) return;
    const monthId = btn.dataset.month;
    const m = months.find(x => x.id === monthId);
    if (!m || !m.audioFile) return;

    const audioUrl = `/uploads/debrief/audio/${m.audioFile}`;
    if (!slideAudio.paused && slideAudio.src.endsWith(m.audioFile)) {
      slideAudio.pause();
      updateDiscSpinState(false);
    } else {
      if (!slideAudio.src.endsWith(m.audioFile)) {
        slideAudio.src = audioUrl;
        slideAudio.currentTime = getAudioStartTime(monthId);
      }
      slideAudio.volume = audioMuted ? 0 : 0.35;
      slideAudio.play().then(() => {
        if (!audioMuted) fadeAudioIn(slideAudio, masterVolume, 500);
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

  // --- Reorder photos within an event slide ---
  async function reorderEventPhoto(monthId, eventId, fromIdx, toIdx, dropSide) {
    const m = months.find(x => x.id === monthId);
    if (!m || !m.events) return;
    const evt = m.events.find(ev => ev.id === eventId);
    if (!evt || !evt.photos || fromIdx < 0 || fromIdx >= evt.photos.length) return;

    // Remove photo from original position
    const [movedPhoto] = evt.photos.splice(fromIdx, 1);

    // Calculate insertion index (adjust for the removal)
    let insertIdx = toIdx;
    if (fromIdx < toIdx) insertIdx--; // shifted after removal
    if (dropSide === 'after') insertIdx++;
    insertIdx = Math.max(0, Math.min(insertIdx, evt.photos.length));

    evt.photos.splice(insertIdx, 0, movedPhoto);

    // Sync to contentData
    if (!contentData.months) contentData.months = {};
    if (!contentData.months[monthId]) contentData.months[monthId] = {};
    if (!contentData.months[monthId].events) contentData.months[monthId].events = [];
    const savedEvt = contentData.months[monthId].events.find(ev => ev.id === eventId);
    if (savedEvt) savedEvt.photos = [...evt.photos];

    await saveAllContent();
    buildSlideList();
    buildSlides();
    jumpToSlide(slideIndex);
  }

  // --- Init ---
  function initLightbox() {
    const lb = document.createElement('div');
    lb.id = 'debrief-lightbox';
    lb.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-inner">
        <button class="lightbox-close">&times;</button>
        <button class="lightbox-prev">&#8249;</button>
        <button class="lightbox-next">&#8250;</button>
        <img class="lightbox-img" src="" alt="">
        <video class="lightbox-video" src="" controls autoplay loop playsinline></video>
      </div>
      <div class="lightbox-caption"></div>`;
    document.body.appendChild(lb);

    const lbImg    = lb.querySelector('.lightbox-img');
    const lbVideo  = lb.querySelector('.lightbox-video');
    const lbCaption = lb.querySelector('.lightbox-caption');
    const lbPrev   = lb.querySelector('.lightbox-prev');
    const lbNext   = lb.querySelector('.lightbox-next');

    let lbItems = [];  // [{src, type, caption, monthId, photoFilename}]
    let lbIndex = -1;

    function renderItem(src, type, caption, monthId, photoFilename) {
      if (type === 'video') {
        lbImg.style.display = 'none';
        lbVideo.style.display = 'block';
        lbVideo.src = src;
        lbVideo.play().catch(() => {});
      } else {
        lbVideo.style.display = 'none';
        lbVideo.pause();
        lbVideo.src = '';
        lbImg.style.display = 'block';
        lbImg.src = src;
      }
      lbCaption.textContent = caption || '';
      lbCaption.dataset.month = monthId || '';
      lbCaption.dataset.photoFilename = photoFilename || '';
      if (role === 'editor') {
        lbCaption.contentEditable = 'true';
        lbCaption.style.display = 'block';
      } else {
        lbCaption.contentEditable = 'false';
        lbCaption.style.display = caption ? 'block' : 'none';
      }
      // Arrow visibility
      lbPrev.style.display = lbItems.length > 1 ? 'flex' : 'none';
      lbNext.style.display = lbItems.length > 1 ? 'flex' : 'none';
    }

    function openLightbox(src, type, caption, monthId, photoFilename) {
      renderItem(src, type, caption, monthId, photoFilename);
      lb.classList.add('active');
      if (role === 'editor' && !caption) setTimeout(() => lbCaption.focus(), 50);
    }

    function lbNavigate(dir) {
      if (!lbItems.length) return;
      lbIndex = (lbIndex + dir + lbItems.length) % lbItems.length;
      const item = lbItems[lbIndex];
      renderItem(item.src, item.type, item.caption, item.monthId, item.photoFilename);
      if (role === 'presenter') {
        socket.emit('debrief:lightbox-open', { src: item.src, type: item.type, caption: item.caption });
      }
    }

    lbPrev.addEventListener('click', (e) => { e.stopPropagation(); lbNavigate(-1); });
    lbNext.addEventListener('click', (e) => { e.stopPropagation(); lbNavigate(1); });

    // Keyboard navigation inside lightbox
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('active')) return;
      if (e.key === 'ArrowLeft')  { e.stopPropagation(); lbNavigate(-1); }
      if (e.key === 'ArrowRight') { e.stopPropagation(); lbNavigate(1); }
      if (e.key === 'Escape') {
        closeLightbox();
        if (role === 'presenter') socket.emit('debrief:lightbox-close');
      }
    }, true);

    lbCaption.addEventListener('blur', async () => {
      if (role !== 'editor') return;
      const monthId  = lbCaption.dataset.month;
      const filename = lbCaption.dataset.photoFilename;
      if (!monthId || !filename) return;
      const caption = lbCaption.textContent.trim();
      if (!contentData.months) contentData.months = {};
      if (!contentData.months[monthId]) contentData.months[monthId] = {};
      if (!contentData.months[monthId].photoCaptions) contentData.months[monthId].photoCaptions = {};
      contentData.months[monthId].photoCaptions[filename] = caption;
      const m = months.find(x => x.id === monthId);
      if (m) {
        if (!m.photoCaptions) m.photoCaptions = {};
        m.photoCaptions[filename] = caption;
        document.querySelectorAll(`.filmstrip-frame[data-photo-filename="${filename}"]`).forEach(f => {
          f.dataset.caption = caption;
        });
      }
      // Update in-memory lbItems too
      if (lbIndex >= 0 && lbItems[lbIndex]) lbItems[lbIndex].caption = caption;
      await saveAllContent();
    });

    function closeLightbox() {
      lb.classList.remove('active');
      lbVideo.pause();
      lbVideo.src = '';
      lbItems = [];
      lbIndex = -1;
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('.photo-delete') || e.target.closest('.photo-delete-event')) return;
      if (e.target.closest('.lightbox-prev') || e.target.closest('.lightbox-next')) return;

      // Filmstrip frame click — presenter and editor
      const filmFrame = e.target.closest('.filmstrip-frame');
      if (filmFrame && filmFrame.dataset.src) {
        if (role !== 'presenter' && role !== 'editor') return;
        // Build item list from unique frames on this slide (dedupe marquee duplicates)
        const seen = new Set();
        lbItems = [...document.querySelectorAll('.slide.active .filmstrip-frame[data-src]')]
          .filter(f => { if (seen.has(f.dataset.src)) return false; seen.add(f.dataset.src); return true; })
          .map(f => ({ src: f.dataset.src, type: f.dataset.type || 'image',
                       caption: f.dataset.caption || '', monthId: f.dataset.month,
                       photoFilename: f.dataset.photoFilename }));
        lbIndex = lbItems.findIndex(i => i.src === filmFrame.dataset.src);
        if (lbIndex < 0) lbIndex = 0;
        const item = lbItems[lbIndex];
        openLightbox(item.src, item.type, item.caption, item.monthId, item.photoFilename);
        if (role === 'presenter') socket.emit('debrief:lightbox-open', { src: item.src, type: item.type, caption: item.caption });
        return;
      }

      // Event media frame click — presenter and editor
      const frame = e.target.closest('.event-media-frame');
      if (frame && frame.dataset.src) {
        if (role !== 'presenter' && role !== 'editor') return;
        lbItems = [...document.querySelectorAll('.slide.active .event-media-frame[data-src]')]
          .map(f => {
            const wrapper = f.closest('.event-photo-wrapper');
            const cap = wrapper ? (wrapper.querySelector('.event-photo-caption')?.textContent.trim() || '') : '';
            return { src: f.dataset.src, type: f.dataset.type || 'image', caption: cap };
          });
        lbIndex = lbItems.findIndex(i => i.src === frame.dataset.src);
        if (lbIndex < 0) lbIndex = 0;
        const item = lbItems[lbIndex];
        openLightbox(item.src, item.type, item.caption);
        socket.emit('debrief:lightbox-open', { src: item.src, type: item.type, caption: item.caption });
        return;
      }

      // Close lightbox
      if (e.target.closest('.lightbox-backdrop') || e.target.closest('.lightbox-close')) {
        closeLightbox();
        if (role === 'presenter') socket.emit('debrief:lightbox-close');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lb.classList.contains('active')) {
        closeLightbox();
        if (role === 'presenter') socket.emit('debrief:lightbox-close');
      }
    });

    // Viewer mirrors presenter
    socket.on('debrief:lightbox-open', (data) => {
      if (role === 'viewer') openLightbox(data.src, data.type, data.caption);
    });
    socket.on('debrief:lightbox-close', () => {
      if (role === 'viewer') closeLightbox();
    });
  }

  async function init() {
    injectVinyls();
    initLightbox();
    await Promise.all([loadContent(), loadConfig()]);
    mergeData();
    buildSlideList();
    initDataLoaded = true;
    initGateAudio(); // must run AFTER loadConfig() so config.gateSongFile is populated
  }

  init();
})();
