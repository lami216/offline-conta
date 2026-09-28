/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alkarnaPrinting', {
  list: () => ipcRenderer.invoke('alkarna:printing:list'),
  getSettings: () => ipcRenderer.invoke('alkarna:printing:get-settings'),
  saveSettings: settings => ipcRenderer.invoke('alkarna:printing:set-settings', settings),
  print: options => ipcRenderer.invoke('alkarna:printing:print', options),
  exportPdf: options => ipcRenderer.invoke('alkarna:printing:export-pdf', options),
  saveExport: options => ipcRenderer.invoke('alkarna:printing:save-export', options),
});
