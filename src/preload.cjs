const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    // IPC methods
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    renderFile: (fileData) => ipcRenderer.invoke('render-file', fileData),
    getRenderProcesses: () => ipcRenderer.invoke('get-render-processes'),
    cancelRender: (id) => ipcRenderer.invoke('cancel-render', id),
    openOutputFolder: (customPath) => ipcRenderer.invoke('open-output-folder', customPath),
    onRenderOutput: (callback) => ipcRenderer.on('render-output', (_, data) => callback(data)),
    
    // Node modules
    path: {
      basename: (filepath, ext) => path.basename(filepath, ext),
      join: (...args) => path.join(...args)
    },
    uuidv4: () => uuidv4()
  }
);