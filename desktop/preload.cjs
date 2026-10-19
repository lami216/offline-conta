/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alkarnaPrinting', {
  list: () => ipcRenderer.invoke('alkarna:printing:list'),
  getSettings: () => ipcRenderer.invoke('alkarna:printing:get-settings'),
  saveSettings: settings => ipcRenderer.invoke('alkarna:printing:set-settings', settings),
  print: options => ipcRenderer.invoke('alkarna:printing:print', options),
  pdf: options => ipcRenderer.invoke('alkarna:printing:pdf', options),
  saveExport: options => ipcRenderer.invoke('alkarna:export:save', options),
});

// Backup-only bridge: no arbitrary file paths, URLs, bytes or admin token.
contextBridge.exposeInMainWorld('alkarnaBackup', {
  save: () => ipcRenderer.invoke('alkarna:backup:save'),
  openFolder: () => ipcRenderer.invoke('alkarna:backup:open-folder'),
});
