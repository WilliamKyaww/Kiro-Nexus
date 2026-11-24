export function redactSecrets(text: string, keys?: string[]): string;
export function sanitiseDiagnostic(text: string, opts?: { keys?: string[]; max?: number }): string;
export function sanitiseDeep<T>(value: T, opts?: { keys?: string[]; max?: number }): T;
