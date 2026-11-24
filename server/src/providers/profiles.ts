// Provider profiles (PRD-074). Stored in the user profile folder, never in a workspace.
// A profile never contains a key.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { NexusError } from "../errors";
import { atomicWrite } from "../workspace/atomic";
import { newId } from "../workspace/service";

export const Capability = z.enum(["unknown", "yes", "no", "error"]);
export const ProviderProfile = z.strictObject({
  id: z.string().regex(/^prf_[0-9A-HJKMNP-TV-Z]{26}$/),
  name: z.string().min(1).max(80),
  baseUrl: z.string().min(1).max(300),
  model: z.string().min(1).max(200),
  createdAt: z.string(),
  capabilities: z.strictObject({
    toolCalling: Capability,
    structuredOutput: Capability,
    testedAt: z.string().nullable(),
    detail: z.string().max(400).nullable(),
    fixture: z.boolean(),
  }),
});
export const ProvidersFile = z.strictObject({
  schemaVersion: z.literal(1),
  selectedId: z.string().nullable(),
  profiles: z.array(ProviderProfile),
});
export type ProviderProfile = z.infer<typeof ProviderProfile>;
export type ProvidersFile = z.infer<typeof ProvidersFile>;

export const NewProfileRequest = z.strictObject({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(200),
});

/** The candidate free route for Q1. Unverified until a real call succeeds. */
export const PROVIDER_TEMPLATES = [
  {
    id: "groq-free",
    label: "Groq free plan (candidate, not yet verified by the team)",
    name: "Groq free plan",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    signUpUrl: "https://console.groq.com/keys",
  },
];

/** https anywhere; plain http only for a model on this computer (Ollama, the test double). */
export function normaliseBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NexusError("VALIDATION", "Enter a full base URL, for example https://api.groq.com/openai/v1.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new NexusError("VALIDATION", "Use an https:// address. Plain http:// is only allowed for a model on this computer.");
  }
  if (url.username || url.password || url.search || url.hash) throw new NexusError("VALIDATION", "The base URL must not contain a user name, password, query or fragment.");
  return url.toString().replace(/\/+$/, "");
}

export const receivingHost = (baseUrl: string) => {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
};

export class ProviderRegistry {
  private data: ProvidersFile = { schemaVersion: 1, selectedId: null, profiles: [] };
  private constructor(private readonly file: string) {}

  static async load(profileDir: string): Promise<ProviderRegistry> {
    const reg = new ProviderRegistry(join(profileDir, "providers.json"));
    try {
      reg.data = ProvidersFile.parse(JSON.parse(await readFile(reg.file, "utf8")));
    } catch { /* missing or unreadable: start empty, never crash */ }
    return reg;
  }

  private async save(): Promise<void> {
    await atomicWrite(this.file, JSON.stringify(ProvidersFile.parse(this.data), null, 2) + "\n");
  }

  list(): ProvidersFile { return structuredClone(this.data); }

  get(id: string): ProviderProfile {
    const p = this.data.profiles.find((x) => x.id === id);
    if (!p) throw new NexusError("NOT_FOUND", "That provider profile does not exist.");
    return p;
  }

  selected(): ProviderProfile | null {
    return this.data.profiles.find((p) => p.id === this.data.selectedId) ?? null;
  }

  async add(input: z.infer<typeof NewProfileRequest>): Promise<ProviderProfile> {
    const profile: ProviderProfile = {
      id: newId("prf"), name: input.name, baseUrl: normaliseBaseUrl(input.baseUrl), model: input.model,
      createdAt: new Date().toISOString(),
      capabilities: { toolCalling: "unknown", structuredOutput: "unknown", testedAt: null, detail: null, fixture: false },
    };
    this.data.profiles.push(profile);
    if (!this.data.selectedId) this.data.selectedId = profile.id;
    await this.save();
    return profile;
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    if (this.data.selectedId === id) this.data.selectedId = this.data.profiles[0]?.id ?? null;
    await this.save();
  }

  async select(id: string): Promise<void> {
    this.get(id);
    this.data.selectedId = id;
    await this.save();
  }

  async setCapabilities(id: string, caps: ProviderProfile["capabilities"]): Promise<ProviderProfile> {
    const p = this.get(id);
    p.capabilities = caps;
    await this.save();
    return p;
  }
}
