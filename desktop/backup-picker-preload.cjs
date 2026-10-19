/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');
// This bridge exists only in the packaged, isolated destination window.
contextBridge.exposeInMainWorld('backupPicker', {
  init: () => ipcRenderer.invoke('alkarna:backup-picker', { action: 'init' }),
  drives: () => ipcRenderer.invoke('alkarna:backup-picker', { action: 'drives' }),
  list: (directory, query) => ipcRenderer.invoke('alkarna:backup-picker', { action: 'list', directory, query }),
  mkdir: (directory, name) => ipcRenderer.invoke('alkarna:backup-picker', { action: 'mkdir', directory, name }),
  select: (directory, filename) => ipcRenderer.invoke('alkarna:backup-picker', { action: 'select', directory, filename }),
  cancel: () => ipcRenderer.invoke('alkarna:backup-picker', { action: 'cancel' }),
});
