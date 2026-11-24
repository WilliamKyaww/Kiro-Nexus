import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { NexusError } from "../errors";

const windowsForbidden = /[<>:"|?*\u0000-\u001f]/;
const reservedNames = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Validate a workspace-relative note path and return its normalised form
 * (forward slashes) and absolute location. Rejects absolute paths, `..`,
 * dot-segments (which hides `.nexus` and temp files), non-.md files and
 * Windows-invalid names.
 */
export function resolveNotePath(root: string, relPath: string): { rel: string; abs: string } {
  const bad = (why: string) => new NexusError("BAD_PATH", `Invalid note path: ${why}`);
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.length > 512) throw bad("empty or too long");
  const norm = relPath.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) throw bad("must be relative to the workspace");
  const segments = norm.split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") throw bad("empty, '.' or '..' segment");
    if (s.startsWith(".")) throw bad("hidden folders and files are not notes");
    if (windowsForbidden.test(s) || reservedNames.test(s) || /[ .]$/.test(s)) throw bad(`'${s}' is not a valid file name`);
  }
  if (!norm.toLowerCase().endsWith(".md")) throw bad("notes must end in .md");
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, ...segments);
  if (!abs.startsWith(rootAbs + sep)) throw bad("outside the workspace");
  return { rel: segments.join("/"), abs };
}

/** Guard against a symlinked folder that escapes the workspace. */
export async function assertInsideRealRoot(root: string, abs: string): Promise<void> {
  const realRoot = await realpath(root);
  let dir = dirname(abs);
  // Walk up to the nearest existing ancestor.
  for (;;) {
    try {
      const realDir = await realpath(dir);
      if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
        throw new NexusError("BAD_PATH", "Invalid note path: resolves outside the workspace");
      }
      return;
    } catch (e) {
      if (e instanceof NexusError) throw e;
      const parent = dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }
}
