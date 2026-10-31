// Puente entre la app y el escritorio: solo expone los diálogos de archivo de proyecto.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProjectAs: (text) => ipcRenderer.invoke('project:saveAs', text),
  writeProject: (path, text) => ipcRenderer.invoke('project:write', path, text),
  readProject: (path) => ipcRenderer.invoke('project:read', path),
  lastProject: () => ipcRenderer.invoke('project:last'),
});
