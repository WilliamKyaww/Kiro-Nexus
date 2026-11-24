// Process-wide state: the open workspace and the event bus.
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { NexusError } from "./errors";
import { addRecent, readRecent } from "./profile";
import { WorkspaceService, type ChangeEvent } from "./workspace/service";

export type Logger = (line: string) => void;

export interface ServerEvent { type: string; [key: string]: unknown }

export class AppState {
  service: WorkspaceService | null = null;
  openError: { code: string; message: string } | null = null;
  readonly bus = new EventEmitter();
  /** Hooks run after a workspace opens (B5 review recovery, B2 watcher). */
  readonly onOpen: Array<(service: WorkspaceService) => Promise<void>> = [];
  readonly onClose: Array<(service: WorkspaceService) => Promise<void>> = [];

  constructor(
    readonly profileDir: string,
    readonly instanceId: string,
    public port: number | null,
    readonly log: Logger,
  ) {
    this.bus.setMaxListeners(100);
  }

  publish(event: ServerEvent): void {
    this.bus.emit("event", event);
  }

  requireService(): WorkspaceService {
    if (!this.service) throw new NexusError("NO_WORKSPACE", "No workspace is open.");
    return this.service;
  }

  async open(path: string): Promise<WorkspaceService> {
    const root = resolve(path);
    if (this.service?.root === root) return this.service;
    await this.closeWorkspace();
    try {
      const service = await WorkspaceService.open(root, {
        lock: { pid: process.pid, instanceId: this.instanceId, port: this.port, startedAt: new Date().toISOString() },
        onLockTakeover: (prev) => this.log(`lock: took over stale lock from pid ${prev.pid}`),
      });
      service.events.on("change", (e: ChangeEvent) => this.publish({ ...e }));
      for (const hook of this.onOpen) await hook(service);
      this.service = service;
      this.openError = null;
      await addRecent(this.profileDir, root);
      this.log(`workspace: opened`);
      this.publish({ type: "workspace.changed" });
      return service;
    } catch (e) {
      this.openError = e instanceof NexusError ? { code: e.code, message: e.message } : { code: "INTERNAL", message: "Could not open the workspace." };
      throw e;
    }
  }

  async closeWorkspace(): Promise<void> {
    const service = this.service;
    if (!service) return;
    this.service = null;
    for (const hook of this.onClose) await hook(service).catch(() => undefined);
    await service.close();
  }

  async recent() {
    return readRecent(this.profileDir);
  }
}
