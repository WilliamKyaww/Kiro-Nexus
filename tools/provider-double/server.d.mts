export interface ProviderDouble {
  port: number;
  baseUrl: string;
  requests: Array<{ model: string; auth: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
}
export function startProviderDouble(port?: number): Promise<ProviderDouble>;
export function buildAnswer(input: { section: unknown; issues: unknown[]; invent?: boolean; citeIssues?: boolean }): unknown;
export function handleChat(body: unknown): { status: number; body: unknown };
