// Sandboxed preload: exposes only the native operations the UI needs (R-S3).
// Keys go to Electron main, which encrypts them; there is no way to read a key back.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nexusNative", {
  appInfo: (): { version: string; platform: string } => ipcRenderer.sendSync("nexus:app-info"),
  pickWorkspaceFolder: (): Promise<string | null> => ipcRenderer.invoke("nexus:pick-workspace-folder"),
  keyStorage: (): Promise<"os-protected" | "session"> => ipcRenderer.invoke("nexus:key-storage"),
  setProviderKey: (profileId: string, key: string): Promise<"os-protected" | "session"> => ipcRenderer.invoke("nexus:set-provider-key", profileId, key),
  deleteProviderKey: (profileId: string): Promise<boolean> => ipcRenderer.invoke("nexus:delete-provider-key", profileId),
});
