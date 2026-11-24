// Sandboxed preload: exposes only the native operations the UI needs (R-S3).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexusNative", {
  appInfo: (): { version: string; platform: string } => ipcRenderer.sendSync("nexus:app-info"),
  pickWorkspaceFolder: (): Promise<string | null> => ipcRenderer.invoke("nexus:pick-workspace-folder"),
});
