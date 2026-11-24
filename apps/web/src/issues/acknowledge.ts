// Issue form drafts: a save acknowledges only the values it submitted (the note editor's rule).
import type { IssuePatch, IssueView } from "@nexus/schema";

/** Unsaved field values, and the issue as it was when the first of them was changed. */
export interface IssueDraft { values: IssuePatch; base: IssueView }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * After a save of `submitted` returned `saved`:
 * - a field whose draft value is still exactly what was submitted is acknowledged and leaves the draft;
 * - a field changed again while the save was in flight stays, now based on the saved value;
 * - a field first changed during the save stays, keeping the base it was typed over, and the
 *   older revision is kept so the server still checks that field against newer edits.
 */
export function acknowledge(draft: IssueDraft | null, submitted: IssuePatch, saved: IssueView): IssueDraft | null {
  if (!draft) return null;
  const kept = (Object.keys(draft.values) as Array<keyof IssuePatch>)
    .filter((f) => !(f in submitted && same(draft.values[f], submitted[f])));
  if (kept.length === 0) return null;
  const values: IssuePatch = Object.fromEntries(kept.map((f) => [f, draft.values[f]]));
  const base: IssueView = { ...saved };
  const notSubmitted = kept.filter((f) => !(f in submitted));
  for (const f of notSubmitted) Object.assign(base, { [f]: draft.base[f] });
  return { values, base: { ...base, revision: notSubmitted.length ? draft.base.revision : saved.revision } };
}
