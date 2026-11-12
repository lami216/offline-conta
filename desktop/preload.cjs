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

contextBridge.exposeInMainWorld('alkarnaBackup', {
  save: () => ipcRenderer.invoke('alkarna:backup:save'),
});

// Narrow methods only: no renderer access to credentials, keys, URLs or arbitrary IPC.
contextBridge.exposeInMainWorld('alkarnaAccess', {
  state: branchId => ipcRenderer.invoke('alkarna:access:state', branchId===undefined?undefined:{branchId}),
  enter: value => ipcRenderer.invoke('alkarna:access:enter', value),
  newRequest: () => ipcRenderer.invoke('alkarna:access:newRequest'),
  request: value => ipcRenderer.invoke('alkarna:access:request', value),
  poll: () => ipcRenderer.invoke('alkarna:access:poll'),
  activate: () => ipcRenderer.invoke('alkarna:access:activate'),
  login: value => ipcRenderer.invoke('alkarna:access:login', value),
  logout: () => ipcRenderer.invoke('alkarna:access:logout'),
  refresh: branchId => ipcRenderer.invoke('alkarna:access:refresh', {branchId}),
  submit: value => ipcRenderer.invoke('alkarna:access:submit', value),
  draft: value => ipcRenderer.invoke('alkarna:access:draft', value),
  ack: operationId => ipcRenderer.invoke('alkarna:access:ack', {operationId}),
});
