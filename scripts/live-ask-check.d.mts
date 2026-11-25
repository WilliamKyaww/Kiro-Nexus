export const EXIT: { pass: 0; checkFailed: 1; setup: 2; auth: 3; timeout: 4; unsupported: 5; fixture: 6; provider: 7 };
export const NEW_ISSUE_TITLE: string;
export interface LiveCheck { name: string; ok: boolean; detail: string }
export interface JourneyScenario {
  notePath: string; headingSlug: string; heading: string;
  missing: { action: string; label: string; issueAfter: string };
  tracked: { action: string; label: string; issue: string };
}
export const KICKOFF: JourneyScenario;
/** records: the issues as stored, so stated titles, statuses and due dates are compared with them (R5-3). */
export function evaluateTurn(message: unknown, turn: 1 | 2, opts: { actionsHeadingExists: boolean; existingIssues: Set<string>; scenario?: JourneyScenario; records?: Array<{ key: string; title: string; status: string; due: unknown }> }): LiveCheck[];
export function workspaceHashes(dir: string): Promise<Record<string, string>>;
export function sanitiseReport(text: string, keys: string[]): string;
export function promptHidden(question: string, input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (on: boolean) => void }, output?: NodeJS.WritableStream): Promise<string | null>;
