'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, shell,
  Notification, nativeImage, dialog, session
} = require('electron');
const path = require('path');
const Store = require('electron-store');

// ── Store ────────────────────────────────────────────────────────────────────
const store = new Store({
  name: 'royal-vault-prefs',
  encryptionKey: 'rvault-desktop-priv-2024',
  defaults: {
    windowBounds: { width: 1200, height: 750 },
    autoLaunch: true,
    lastUser: null,
    sitePassword: null
  }
});

const API_BASE = 'https://royalkvault.up.railway.app';

let mainWindow = null;
let tray = null;
let presenceKaliph = 'offline';
let presenceKathrine = 'offline';

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
  // Inline 1×1 fallback
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  );
}

// ── Create main window ────────────────────────────────────────────────────────
function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,         // allow cross-origin fetch to Railway backend
      allowRunningInsecureContent: false,
      session: session.fromPartition('persist:royalvault')
    },
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Remember window bounds
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Hide instead of close (app stays in tray)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.includes('royalkvault.up.railway.app') && !url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
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
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Vault',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
    },
    { type: 'separator' },
    {
      label: `Kaliph — ${presenceKaliph}`,
      enabled: false
    },
    {
      label: `Kathrine — ${presenceKathrine}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: autoLaunch,
      click: (item) => {
        store.set('autoLaunch', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked });
        if (mainWindow) mainWindow.webContents.send('auto-launch-changed', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Royal Vault',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
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
ipcMain.handle('store-get-all', () => store.store);

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

// File picker
ipcMain.handle('show-open-dialog', async (_, options) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, options);
});

// Presence updates from renderer (update tray menu)
ipcMain.on('presence-update', (_, { user, state }) => {
  if (user === 'kaliph') presenceKaliph = state;
  if (user === 'kathrine') presenceKathrine = state;
  buildTrayMenu();
});

// Switch user from tray
ipcMain.handle('switch-user', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.webContents.send('switch-user');
  }
});

// Clear persistent session cookies (logout)
ipcMain.handle('clear-session', async () => {
  const ses = session.fromPartition('persist:royalvault');
  await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Set auto-launch state from stored pref
  const autoLaunch = store.get('autoLaunch');
  app.setLoginItemSettings({ openAtLogin: autoLaunch });

  // Inject CORS-allow headers on Railway responses so renderer fetch works
  const ses = session.fromPartition('persist:royalvault');
  ses.webRequest.onHeadersReceived({ urls: ['https://royalkvault.up.railway.app/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type', 'Authorization', 'Cookie'];
    headers['Access-Control-Allow-Credentials'] = ['true'];
    callback({ responseHeaders: headers });
  });

  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  // On macOS keep running until explicitly quit
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
