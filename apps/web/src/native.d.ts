// Exposed by apps/desktop/src/preload.ts in Electron only.
interface NexusNative {
  appInfo(): { version: string; platform: string };
  pickWorkspaceFolder(): Promise<string | null>;
  keyStorage(): Promise<"os-protected" | "session">;
  setProviderKey(profileId: string, key: string): Promise<"os-protected" | "session">;
  deleteProviderKey(profileId: string): Promise<boolean>;
}

interface Window {
  nexusNative?: NexusNative;
}
