// Exposed by apps/desktop/src/preload.ts in Electron only.
interface NexusNative {
  appInfo(): { version: string; platform: string };
  pickWorkspaceFolder(): Promise<string | null>;
}

interface Window {
  nexusNative?: NexusNative;
}
