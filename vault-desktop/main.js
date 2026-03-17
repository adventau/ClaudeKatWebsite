'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, shell,
  Notification, nativeImage, session
} = require('electron');
const path = require('path');
const Store = require('electron-store');
const net = require('net');

// ── Store ────────────────────────────────────────────────────────────────────
const store = new Store({
  name: 'royal-vault-prefs',
  encryptionKey: 'rvault-desktop-priv-2024',
  defaults: {
    windowBounds: { width: 1200, height: 750 },
    autoLaunch: true,
    sitePassword: null,
    lastProfile: null,
    profileAvatar: null
  }
});

const APP_URL = 'https://royalkvault.up.railway.app';

let mainWindow = null;
let tray = null;

// ── Tray icon ─────────────────────────────────────────────────────────────────
function buildTrayIcon() {
  const iconPath = path.join(__dirname, 'build', 'tray.png');
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      const resized = img.resize({ width: 16, height: 16 });
      resized.setTemplateImage(true);
      return resized;
    }
  } catch (_) { /* fall through */ }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  );
}

// ── Determine what to show on launch ────────────────────────────────────────
function hasStoredCredentials() {
  return store.get('sitePassword') && store.get('lastProfile');
}

// ── Create main window ──────────────────────────────────────────────────────
function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#0a0612',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      session: session.fromPartition('persist:royalvault')
    },
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png')
  });

  if (hasStoredCredentials()) {
    // Returning user — show custom PIN screen
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'pin.html'));
  } else {
    // First launch — show website for full auth
    loadWebsite();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Remember window bounds
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Hide instead of close (app stays in tray — keeps socket.io alive for notifications)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('about:') && !url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Allow web notifications (for when app is hidden to tray)
  const ses = session.fromPartition('persist:royalvault');
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true);
    } else {
      callback(true); // Allow other permissions too
    }
  });
}

function loadWebsite() {
  mainWindow.loadURL(APP_URL);

  // Remove old listeners to avoid duplicates
  mainWindow.webContents.removeAllListeners('did-finish-load');
  mainWindow.webContents.removeAllListeners('did-navigate');

  // Inject desktop tweaks once the website loads
  mainWindow.webContents.on('did-finish-load', () => {
    injectDesktopCSS();
    injectCredentialCapture();
  });

  // Re-inject desktop CSS when navigating to /app + capture avatar
  mainWindow.webContents.on('did-navigate', (_, url) => {
    if (url.includes('/app')) {
      injectDesktopCSS();
      // Capture avatar after a short delay to let the app initialize
      setTimeout(() => {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            try {
              const users = window._users || {};
              const profile = '${store.get('lastProfile') || ''}';
              const u = users[profile];
              if (u && u.avatar && window.electron) {
                window.electron.store.set('profileAvatar', '${APP_URL}' + u.avatar);
              }
            } catch {}
          })()
        `).catch(() => {});
      }, 3000);
    }
  });
}

function injectDesktopCSS() {
  const currentURL = mainWindow.webContents.getURL();

  // Insert drag bar for window movement
  mainWindow.webContents.executeJavaScript(`
    if (!document.getElementById('electron-drag-bar')) {
      const bar = document.createElement('div');
      bar.id = 'electron-drag-bar';
      document.body.prepend(bar);
    }
  `);

  mainWindow.webContents.insertCSS(`
    /* Invisible drag bar at top of window for macOS window dragging */
    #electron-drag-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 28px;
      -webkit-app-region: drag;
      z-index: 99999;
      pointer-events: auto;
    }
    /* Nudge sidebar down so traffic lights don't overlap content */
    #sidebar { padding-top: 32px !important; }
    #sidebar .sidebar-user { margin-top: 4px !important; }
  `);
}

function injectCredentialCapture() {
  // Hook into the website's fetch to capture credentials on successful auth
  mainWindow.webContents.executeJavaScript(`
    (function() {
      if (window._electronAuthHooked) return;
      window._electronAuthHooked = true;

      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

        try {
          // Capture site password on successful auth
          if (url.includes('/api/auth/password') && res.ok) {
            const clone = res.clone();
            const data = await clone.json();
            if (data.success && !data.isGuest && window.electron) {
              const pwInput = document.getElementById('pw-input');
              if (pwInput && pwInput.value) {
                window.electron.storeSitePassword(pwInput.value);
              }
            }
          }

          // Capture profile on successful profile auth
          if (url.includes('/api/auth/profile') && res.ok) {
            const clone = res.clone();
            const data = await clone.json();
            if (data.success && window.electron) {
              // Get profile from the request body
              const reqBody = args[1]?.body;
              if (reqBody) {
                try {
                  const parsed = JSON.parse(reqBody);
                  if (parsed.profile) {
                    window.electron.store.set('lastProfile', parsed.profile);
                  }
                } catch {}
              }
            }
          }
        } catch {}

        return res;
      };
    })();
  `);
}

function saveBounds() {
  if (!mainWindow) return;
  store.set('windowBounds', mainWindow.getBounds());
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Royal Vault');
  buildTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    }
  });
}

function buildTrayMenu() {
  const autoLaunch = store.get('autoLaunch');
  const profile = store.get('lastProfile');
  const items = [
    {
      label: 'Open Vault',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
    },
    { type: 'separator' }
  ];

  if (profile) {
    items.push({
      label: `Logged in as ${profile.charAt(0).toUpperCase() + profile.slice(1)}`,
      enabled: false
    });
    items.push({ type: 'separator' });
  }

  items.push({
    label: 'Launch at Login',
    type: 'checkbox',
    checked: autoLaunch,
    click: (item) => {
      store.set('autoLaunch', item.checked);
      app.setLoginItemSettings({ openAtLogin: item.checked });
    }
  });
  items.push({ type: 'separator' });
  items.push({
    label: 'Quit Royal Vault',
    click: () => {
      app.isQuitting = true;
      app.quit();
    }
  });

  const menu = Menu.buildFromTemplate(items);
  tray.setContextMenu(menu);
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

// Window controls
ipcMain.on('window-control', (_, action) => {
  if (!mainWindow) return;
  switch (action) {
    case 'minimize': mainWindow.minimize(); break;
    case 'maximize':
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
      break;
    case 'close': mainWindow.hide(); break;
    case 'quit':
      app.isQuitting = true;
      app.quit();
      break;
  }
});

// Electron Store
ipcMain.handle('store-get', (_, key) => store.get(key));
ipcMain.handle('store-set', (_, key, val) => { store.set(key, val); });
ipcMain.handle('store-delete', (_, key) => { store.delete(key); });

// Native notifications
ipcMain.handle('show-notification', (_, { title, body, urgent }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: false,
    urgency: urgent ? 'critical' : 'normal'
  });
  n.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  n.show();
});

// Open external links
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

// Auto-launch toggle
ipcMain.handle('set-auto-launch', (_, val) => {
  store.set('autoLaunch', val);
  app.setLoginItemSettings({ openAtLogin: val });
});
ipcMain.handle('get-auto-launch', () => store.get('autoLaunch'));

// ── PIN submission from custom PIN screen ────────────────────────────────────
ipcMain.handle('submit-pin', async (_, pin) => {
  const sitePassword = store.get('sitePassword');
  const profile = store.get('lastProfile');

  if (!sitePassword || !profile) {
    return { success: false, error: 'No stored credentials' };
  }

  const ses = session.fromPartition('persist:royalvault');
  const { net: electronNet } = require('electron');

  try {
    // Step 1: Authenticate with site password
    const passRes = await electronNet.fetch(APP_URL + '/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: sitePassword }),
      session: ses
    });
    const passData = await passRes.json();

    if (!passData.success) {
      // Site password no longer valid — clear stored creds
      store.delete('sitePassword');
      store.delete('lastProfile');
      return { success: false, error: 'Session expired. Restarting…', restart: true };
    }

    // Step 2: Submit profile + PIN
    const pinRes = await electronNet.fetch(APP_URL + '/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, passcode: pin }),
      session: ses
    });
    const pinData = await pinRes.json();

    if (pinData.success) {
      // Fetch avatar for next PIN screen
      try {
        const usersRes = await electronNet.fetch(APP_URL + '/api/users', {
          session: ses
        });
        const usersData = await usersRes.json();
        const u = Array.isArray(usersData)
          ? usersData.find(u => u.name?.toLowerCase() === profile)
          : usersData[profile];
        if (u && u.avatar) {
          store.set('profileAvatar', APP_URL + u.avatar);
        }
      } catch (_) { /* not critical */ }

      // Navigate to the website app page
      mainWindow.webContents.removeAllListeners('did-finish-load');
      mainWindow.webContents.on('did-finish-load', injectDesktopCSS);
      mainWindow.loadURL(APP_URL + '/app');
      buildTrayMenu();
      return { success: true };
    } else {
      return { success: false, error: pinData.error || 'Incorrect PIN' };
    }
  } catch (err) {
    return { success: false, error: 'Connection failed. Check your internet.' };
  }
});

// Reset stored user — go back to full website auth
ipcMain.handle('reset-stored-user', () => {
  store.delete('sitePassword');
  store.delete('lastProfile');
  store.delete('profileAvatar');
  loadWebsite();
});

// Store site password after first successful auth on website
ipcMain.handle('store-site-password', (_, password) => {
  store.set('sitePassword', password);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const autoLaunch = store.get('autoLaunch');
  app.setLoginItemSettings({ openAtLogin: autoLaunch });

  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
