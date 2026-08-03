const { contextBridge, ipcRenderer } = require("electron");

const desktopApi = {
  isDesktop: true,
  platform: process.platform,
  windowControl: (action) => ipcRenderer.invoke("stylo-window-control", action),
  onWindowStateChange: (callback) => {
    if (typeof callback !== "function") return undefined;
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("stylo-window-state", handler);
    return () => ipcRenderer.removeListener("stylo-window-state", handler);
  }
};

contextBridge.exposeInMainWorld("styloDesktop", desktopApi);
// Temporary renderer compatibility for the currently deployed Pages build.
contextBridge.exposeInMainWorld("qalamDesktop", desktopApi);
