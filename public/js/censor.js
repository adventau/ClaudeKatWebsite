/* ═══════════════════════════════════════════════════════════════════
   DEMO / CENSOR MODE
   Run  censorMode()  in the browser console (or via eval terminal)
   to activate. Run  uncensorMode()  to deactivate.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────
  const STORAGE_KEY = 'rkk-censor-mode';
  const CENSOR_CLASS = 'censor-active';
  const NAMES_TO_CENSOR = ['kaliph', 'kathrine', 'kat', 'kai'];
  const NAME_REGEX = /\b(Kaliph|Kathrine|Kat(?:hrine)?|Kai)\b/gi;

  // Characters for the scramble effect — visually interesting unicode
  const SCRAMBLE_CHARS = '▓░▒█▄▀■□▪▫●○◆◇◈◉';

  // ── State ───────────────────────────────────────────────────────────
  let _censorActive = false;
  let _observer = null;
  let _k108RevealedProfiles = new Set(); // profile IDs revealed via command bar

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Generate a scrambled string of the same length with unicode block chars */
  function scrambleText(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') {
        out += text[i];
      } else {
        out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
    }
    return out;
  }

  /** Reduce a name to initials: "John Smith" -> "J. S." */
  function toInitials(name) {
    return name.split(/\s+/).map(w => w[0] ? w[0].toUpperCase() + '.' : '').join(' ');
  }

  /** Replace sensitive names in a text node or element's textContent */
  function censorNameInText(text) {
    return text.replace(NAME_REGEX, function(match) {
      return scrambleText(match);
    });
  }

  /** Detect which page we're on */
  function getPage() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') return 'login';
    if (path === '/app' || path === '/app.html') return 'app';
    if (path === '/k108' || path === '/k108.html') return 'k108';
    return 'other';
  }

  // ══════════════════════════════════════════════════════════════════
  //  LOGIN PAGE CENSORING
  // ══════════════════════════════════════════════════════════════════
  function censorLoginPage() {
    // Change title
    const h1 = document.querySelector('.vault-title h1');
    if (h1) {
      h1.setAttribute('data-original', h1.innerHTML);
      h1.innerHTML = 'The Royal K<br>Vault';
    }
    const titleTag = document.querySelector('title');
    if (titleTag) {
      titleTag.setAttribute('data-original', titleTag.textContent);
      titleTag.textContent = 'The Royal K Vault';
    }
    // Censor profile card names
    document.querySelectorAll('.card-name').forEach(el => {
      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', el.textContent);
      }
      el.textContent = scrambleText(el.textContent);
    });
  }

  function uncensorLoginPage() {
    const h1 = document.querySelector('.vault-title h1');
    if (h1 && h1.getAttribute('data-original')) h1.innerHTML = h1.getAttribute('data-original');
    const titleTag = document.querySelector('title');
    if (titleTag && titleTag.getAttribute('data-original')) titleTag.textContent = titleTag.getAttribute('data-original');
    document.querySelectorAll('.card-name').forEach(el => {
      if (el.getAttribute('data-original')) el.textContent = el.getAttribute('data-original');
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  MAIN APP CENSORING
  // ══════════════════════════════════════════════════════════════════
  function censorApp() {
    document.body.classList.add(CENSOR_CLASS);

    // ── Censor profile/user names ──
    censorAppNames();

    // ── Site title ──
    const siteTitle = document.querySelector('.site-title');
    if (siteTitle) {
      siteTitle.setAttribute('data-original', siteTitle.textContent);
      siteTitle.textContent = 'Royal K';
    }

    // ── Money fullscreen title ──
    const moneyTitle = document.querySelector('.money-fs-title');
    if (moneyTitle) {
      moneyTitle.setAttribute('data-original', moneyTitle.textContent);
      moneyTitle.textContent = 'Royal K \u00b7 Money';
    }

    // ── Money setup labels ──
    document.querySelectorAll('.money-setup-field label').forEach(el => {
      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', el.textContent);
        el.textContent = scrambleText(el.textContent);
      }
    });

    // The CSS class handles blur for chat, notes, money values via stylesheet
  }

  function censorAppNames() {
    // Sidebar user name
    const myName = document.getElementById('my-name');
    if (myName && !myName.getAttribute('data-original')) {
      myName.setAttribute('data-original', myName.textContent);
      myName.textContent = scrambleText(myName.textContent);
    }

    // Chat header name
    const otherName = document.getElementById('other-name');
    if (otherName && !otherName.getAttribute('data-original')) {
      otherName.setAttribute('data-original', otherName.textContent);
      otherName.textContent = scrambleText(otherName.textContent);
    }

    // Typing indicator name
    const typingName = document.getElementById('typing-name');
    if (typingName && !typingName.getAttribute('data-original')) {
      typingName.setAttribute('data-original', typingName.textContent);
      typingName.textContent = scrambleText(typingName.textContent);
    }

    // Stealth banner names
    document.querySelectorAll('#stealth-banner .custom-select-option, #stealth-target-name').forEach(el => {
      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', el.textContent);
        el.textContent = scrambleText(el.textContent);
      }
    });

    // Profile viewer modal names
    const pvName = document.getElementById('pv-name');
    if (pvName && pvName.textContent && !pvName.getAttribute('data-original')) {
      pvName.setAttribute('data-original', pvName.textContent);
      pvName.textContent = scrambleText(pvName.textContent);
    }
    const pvUser = document.getElementById('pv-username');
    if (pvUser && pvUser.textContent && !pvUser.getAttribute('data-original')) {
      pvUser.setAttribute('data-original', pvUser.textContent);
      pvUser.textContent = scrambleText(pvUser.textContent);
    }
  }

  function uncensorApp() {
    document.body.classList.remove(CENSOR_CLASS);

    // Restore all data-original elements
    document.querySelectorAll('[data-original]').forEach(el => {
      if (el.tagName === 'TITLE') {
        el.textContent = el.getAttribute('data-original');
      } else if (el.getAttribute('data-original-html')) {
        el.innerHTML = el.getAttribute('data-original');
      } else {
        el.textContent = el.getAttribute('data-original');
      }
      el.removeAttribute('data-original');
      el.removeAttribute('data-original-html');
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  K-108 CENSORING
  // ══════════════════════════════════════════════════════════════════
  function censorK108() {
    document.body.classList.add(CENSOR_CLASS);
    _k108RevealedProfiles.clear();
    censorK108Dashboard();
    censorK108Profiles();
  }

  function censorK108Dashboard() {
    // Saved lookups — censor
    const savedPanel = document.getElementById('saved-searches-list');
    if (savedPanel) savedPanel.classList.add('censor-blur-light');

    // Case info — censor
    const casesArea = document.getElementById('cases-list-area');
    if (casesArea) casesArea.classList.add('censor-blur-light');
    const caseWs = document.getElementById('case-ws-area');
    if (caseWs) caseWs.classList.add('censor-blur-light');
  }

  /** Censor profile search results — show initials only, hide photos */
  function censorK108ProfileList() {
    // Autofill dropdown items
    document.querySelectorAll('.profile-af-item').forEach(el => {
      // Photo
      const photo = el.querySelector('.profile-af-avatar img');
      if (photo) photo.style.filter = 'blur(8px)';
      const avatar = el.querySelector('.profile-af-avatar');
      if (avatar && !avatar.getAttribute('data-original')) {
        avatar.setAttribute('data-original', avatar.textContent);
        // Only show initials in the avatar circle
      }
      // Name
      const nameEl = el.querySelector('.profile-af-name');
      if (nameEl && !nameEl.getAttribute('data-censored')) {
        nameEl.setAttribute('data-censored', '1');
        nameEl.setAttribute('data-original', nameEl.textContent);
        nameEl.textContent = toInitials(nameEl.textContent);
      }
      // Relation — keep visible (user wants initials + relation status shown)
    });
  }

  /** Censor a profile detail view — full blur unless revealed */
  function censorK108ProfileDetail() {
    const detail = document.getElementById('profile-detail');
    if (!detail || detail.style.display === 'none') return;

    // Check if this profile was revealed
    if (typeof currentProfileId !== 'undefined' && _k108RevealedProfiles.has(currentProfileId)) {
      detail.classList.remove('censor-profile-blur');
      return;
    }
    detail.classList.add('censor-profile-blur');
  }

  function censorK108Profiles() {
    censorK108ProfileList();
    censorK108ProfileDetail();
  }

  function uncensorK108() {
    document.body.classList.remove(CENSOR_CLASS);
    _k108RevealedProfiles.clear();

    const savedPanel = document.getElementById('saved-searches-list');
    if (savedPanel) savedPanel.classList.remove('censor-blur-light');
    const casesArea = document.getElementById('cases-list-area');
    if (casesArea) casesArea.classList.remove('censor-blur-light');
    const caseWs = document.getElementById('case-ws-area');
    if (caseWs) caseWs.classList.remove('censor-blur-light');

    // Remove profile blur
    const detail = document.getElementById('profile-detail');
    if (detail) detail.classList.remove('censor-profile-blur');

    // Restore censored autofill items
    document.querySelectorAll('[data-censored]').forEach(el => {
      if (el.getAttribute('data-original')) el.textContent = el.getAttribute('data-original');
      el.removeAttribute('data-censored');
      el.removeAttribute('data-original');
    });
    document.querySelectorAll('.profile-af-avatar img').forEach(img => {
      img.style.filter = '';
    });
  }

  // ══════════════════════════════════════════════════════════════════
  //  MUTATION OBSERVER — re-apply censoring on dynamic DOM changes
  // ══════════════════════════════════════════════════════════════════
  function startObserver() {
    if (_observer) return;

    _observer = new MutationObserver(function (mutations) {
      if (!_censorActive) return;
      const page = getPage();

      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length) {
          if (page === 'app') {
            censorAppNames();
          } else if (page === 'k108') {
            // Re-censor profile list whenever new items are added
            censorK108Profiles();
            censorK108Dashboard();
          }
        }
      }
    });

    _observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserver() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  K-108 REVEAL COMMAND — reveals current profile only
  // ══════════════════════════════════════════════════════════════════
  function revealCurrentProfile() {
    if (!_censorActive) return 'Censor mode is not active.';
    if (typeof currentProfileId === 'undefined' || !currentProfileId) {
      return 'No profile is currently open.';
    }
    _k108RevealedProfiles.add(currentProfileId);
    const detail = document.getElementById('profile-detail');
    if (detail) detail.classList.remove('censor-profile-blur');
    return 'Profile #' + currentProfileId + ' revealed. Related profiles remain censored.';
  }

  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  window.censorMode = function () {
    if (_censorActive) return 'Censor mode is already active.';
    _censorActive = true;
    sessionStorage.setItem(STORAGE_KEY, '1');

    const page = getPage();
    if (page === 'login') censorLoginPage();
    else if (page === 'app') censorApp();
    else if (page === 'k108') censorK108();

    startObserver();
    console.log('%c[CENSOR] Demo mode activated', 'color:#a78bfa;font-weight:bold');
    return 'Demo mode activated. Run uncensorMode() to deactivate.';
  };

  window.uncensorMode = function () {
    if (!_censorActive) return 'Censor mode is not active.';
    _censorActive = false;
    sessionStorage.removeItem(STORAGE_KEY);
    stopObserver();

    const page = getPage();
    if (page === 'login') uncensorLoginPage();
    else if (page === 'app') uncensorApp();
    else if (page === 'k108') uncensorK108();

    console.log('%c[CENSOR] Demo mode deactivated', 'color:#4ade80;font-weight:bold');
    return 'Demo mode deactivated.';
  };

  /** K-108 command bar hook — called by execCmdBar for "reveal" command */
  window._censorRevealProfile = revealCurrentProfile;

  /** Check if censor mode is active (used by other scripts) */
  window.isCensorMode = function () { return _censorActive; };

  // ══════════════════════════════════════════════════════════════════
  //  AUTO-ACTIVATE on page load if previously activated this session
  // ══════════════════════════════════════════════════════════════════
  function autoActivate() {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') {
      // Small delay to let the page render first
      setTimeout(function () {
        window.censorMode();
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoActivate);
  } else {
    autoActivate();
  }

  // ══════════════════════════════════════════════════════════════════
  //  SOCKET LISTENER — eval terminal can trigger censor mode remotely
  // ══════════════════════════════════════════════════════════════════
  function listenSocket() {
    if (typeof io === 'undefined' && typeof socket === 'undefined') return;
    var s = typeof socket !== 'undefined' ? socket : null;
    if (!s) {
      try { s = io(); } catch (e) { return; }
    }
    s.on('censor-mode', function (data) {
      if (data && data.active) {
        if (!_censorActive) window.censorMode();
      } else {
        if (_censorActive) window.uncensorMode();
      }
    });
  }

  // Listen after a short delay to ensure socket.io is ready
  setTimeout(listenSocket, 1000);

})();
