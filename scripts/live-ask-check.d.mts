export const EXIT: { pass: 0; checkFailed: 1; setup: 2; auth: 3; timeout: 4; unsupported: 5; fixture: 6; provider: 7 };
export interface LiveCheck { name: string; ok: boolean; detail: string }
export function evaluateAnswer(message: unknown, opts: { actionsHeadingExists: boolean; nex1Exists: boolean }): LiveCheck[];
export function sanitiseReport(text: string, keys: string[]): string;
