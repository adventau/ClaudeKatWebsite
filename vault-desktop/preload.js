'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // ── Platform info ───────────────────────────────────────────────
  platform: process.platform,

  // ── Window controls ─────────────────────────────────────────────
  minimize:    () => ipcRenderer.send('window-control', 'minimize'),
  maximize:    () => ipcRenderer.send('window-control', 'maximize'),
  closeWindow: () => ipcRenderer.send('window-control', 'close'),
  quit:        () => ipcRenderer.send('window-control', 'quit'),

  // ── Persistent key-value store ──────────────────────────────────
  store: {
    get:    (key)       => ipcRenderer.invoke('store-get', key),
    set:    (key, val)  => ipcRenderer.invoke('store-set', key, val),
    delete: (key)       => ipcRenderer.invoke('store-delete', key),
    getAll: ()          => ipcRenderer.invoke('store-get-all')
  },

  // ── Native notifications ────────────────────────────────────────
  notify: (title, body, opts = {}) =>
    ipcRenderer.invoke('show-notification', { title, body, ...opts }),

  // ── Shell / external ────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ── Auto-launch ─────────────────────────────────────────────────
  setAutoLaunch: (val) => ipcRenderer.invoke('set-auto-launch', val),
  getAutoLaunch: ()    => ipcRenderer.invoke('get-auto-launch'),

  // ── File picker ─────────────────────────────────────────────────
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // ── Presence (updates tray menu) ────────────────────────────────
  sendPresenceToTray: (user, state) =>
    ipcRenderer.send('presence-update', { user, state }),

  // ── Session ─────────────────────────────────────────────────────
  clearSession: () => ipcRenderer.invoke('clear-session'),

  // ── Events from main process ────────────────────────────────────
  on: (channel, cb) => {
    const allowed = ['switch-user', 'open-vault', 'auto-launch-changed'];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => cb(...args));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel)
});
