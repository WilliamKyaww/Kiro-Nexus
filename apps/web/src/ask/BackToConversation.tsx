import { Link, useSearchParams } from "react-router";

/** Shown on a note or issue opened from a citation, so the user can return to the answer. */
export function BackToConversation() {
  const [params] = useSearchParams();
  const from = params.get("from");
  if (!from || !/^\/c\/cnv_[0-9A-HJKMNP-TV-Z]{26}$/.test(from)) return null;
  return <p className="back-link"><Link to={from}>← Back to conversation</Link></p>;
}
