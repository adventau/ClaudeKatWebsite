'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isDesktopApp: true,

  // Window controls
  minimize:    () => ipcRenderer.send('window-control', 'minimize'),
  maximize:    () => ipcRenderer.send('window-control', 'maximize'),
  closeWindow: () => ipcRenderer.send('window-control', 'close'),
  quit:        () => ipcRenderer.send('window-control', 'quit'),

  // Persistent key-value store
  store: {
    get:    (key)       => ipcRenderer.invoke('store-get', key),
    set:    (key, val)  => ipcRenderer.invoke('store-set', key, val),
    delete: (key)       => ipcRenderer.invoke('store-delete', key)
  },

  // Native notifications
  notify: (title, body, opts = {}) =>
    ipcRenderer.invoke('show-notification', { title, body, ...opts }),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Auto-launch
  setAutoLaunch: (val) => ipcRenderer.invoke('set-auto-launch', val),
  getAutoLaunch: ()    => ipcRenderer.invoke('get-auto-launch'),

  // PIN screen auth
  submitPin: (pin) => ipcRenderer.invoke('submit-pin', pin),
  resetStoredUser: () => ipcRenderer.invoke('reset-stored-user'),

  // Store site password (called from website after first auth)
  storeSitePassword: (pw) => ipcRenderer.invoke('store-site-password', pw)
});
