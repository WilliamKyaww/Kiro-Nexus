import { ApiError } from "../api";

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong.";
  return <p className="error" role="alert">{message}</p>;
}
