export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN_HOST" | "BAD_PATH" | "VALIDATION" | "NOT_FOUND" | "EXISTS"
  | "REVISION_MISMATCH" | "LOCKED" | "NO_WORKSPACE" | "INVALID_DATA" | "WRITE_FAILED" | "CONFLICT" | "INTERNAL";

const statusFor: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN_HOST: 403, BAD_PATH: 400, VALIDATION: 400, NOT_FOUND: 404, EXISTS: 409,
  REVISION_MISMATCH: 409, LOCKED: 423, NO_WORKSPACE: 409, INVALID_DATA: 500, WRITE_FAILED: 500, CONFLICT: 409, INTERNAL: 500,
};

export class NexusError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.status = statusFor[code];
  }
}

export const isNodeError = (e: unknown): e is NodeJS.ErrnoException => e instanceof Error && "code" in e;
