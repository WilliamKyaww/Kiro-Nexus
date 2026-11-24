export const EXIT: { pass: 0; checkFailed: 1; setup: 2; auth: 3; timeout: 4; unsupported: 5; fixture: 6; provider: 7 };
export const NEW_ISSUE_TITLE: string;
export interface LiveCheck { name: string; ok: boolean; detail: string }
export function evaluateTurn(message: unknown, turn: 1 | 2, opts: { actionsHeadingExists: boolean; existingIssues: Set<string> }): LiveCheck[];
export function workspaceHashes(dir: string): Promise<Record<string, string>>;
export function sanitiseReport(text: string, keys: string[]): string;
export function promptHidden(question: string, input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => void }, output?: NodeJS.WritableStream): Promise<string | null>;
