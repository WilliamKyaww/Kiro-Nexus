// Sanitise provider diagnostics before they are shown, logged or saved (PRD-076).
// Plain ESM so that the service (bundled) and the live-check CLI (plain Node) share it.
//
// Removes, in order:
//   1. every known key, and any run of 8 or more characters copied from one;
//   2. strings shaped like common provider keys, bearer tokens and key query parameters;
//   3. control and bidirectional-override characters (ANSI escapes, newlines), which could
//      forge log lines or disguise text;
// and caps the length.

const REDACTED = "[redacted key]";
const FRAGMENT = 8;

const KEY_SHAPES = [
  /\bsk-(?:proj-|or-v1-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bgsk_[A-Za-z0-9]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
];

function redactKnown(text, keys) {
  let out = text;
  for (const key of keys) {
    if (typeof key !== "string" || key.length < 6) continue;
    out = out.split(key).join(REDACTED);
    if (key.length < FRAGMENT + 4) continue;
    // Any 8-character window of the key marks those characters; each marked run is removed.
    const windows = new Set();
    for (let i = 0; i + FRAGMENT <= key.length; i++) windows.add(key.slice(i, i + FRAGMENT));
    const marked = new Uint8Array(out.length);
    let any = false;
    for (let i = 0; i + FRAGMENT <= out.length; i++) {
      if (windows.has(out.slice(i, i + FRAGMENT))) { marked.fill(1, i, i + FRAGMENT); any = true; }
    }
    if (!any) continue;
    let next = "";
    for (let i = 0; i < out.length;) {
      if (!marked[i]) { next += out[i]; i++; continue; }
      while (i < out.length && marked[i]) i++;
      next += REDACTED;
    }
    out = next;
  }
  return out;
}

/** Remove keys, key fragments and key-shaped strings. Keeps the text's layout. */
export function redactSecrets(text, keys = []) {
  let out = redactKnown(String(text ?? ""), keys);
  for (const re of KEY_SHAPES) out = out.replace(re, REDACTED);
  return out
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/gi, "$1[redacted]");
}

/** For one-line diagnostics: redact, strip control characters, collapse spaces, cap the length. */
export function sanitiseDiagnostic(text, { keys = [], max = 300 } = {}) {
  const flat = redactSecrets(text, keys)
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

/** Apply sanitiseDiagnostic to every string in a JSON-like value (for reports). */
export function sanitiseDeep(value, opts) {
  if (typeof value === "string") return sanitiseDiagnostic(value, opts);
  if (Array.isArray(value)) return value.map((v) => sanitiseDeep(v, opts));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitiseDeep(v, opts)]));
  return value;
}
