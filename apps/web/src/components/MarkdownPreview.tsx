import { createContext, useContext, useMemo, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";
import { Link } from "react-router";
import { parseHeadings, resolveNoteTarget, slugOf, wikilinkIgnore, wikilinkRegExp } from "@nexus/markdown";
import { notePathParam } from "../api";

// The same pattern and the same skipped nodes as linksIn, so the backlinks find the links the
// preview shows and no others (backlinks-completion 1.3, R6-16).
const wikilink = wikilinkRegExp();
const issueKey = /\b([A-Z][A-Z0-9]{1,9}-[1-9][0-9]*)\b/g;

/** Turn [[wikilinks]] and known issue keys into nexus: links. Raw HTML is never rendered. */
function remarkNexusLinks(options: { issueKeys: ReadonlySet<string> }) {
  return (tree: Root) => {
    findAndReplace(tree, [
      [wikilink, (_all: string, target: string, heading?: string, alias?: string) => ({
        type: "link" as const,
        url: `nexus-note:${encodeURIComponent(target.trim())}${heading ? `#${encodeURIComponent(heading.trim())}` : ""}`,
        children: [{ type: "text" as const, value: alias?.trim() || (heading ? `${target.trim()} › ${heading.trim()}` : target.trim()) }],
      })],
      [issueKey, (all: string, key: string) => (options.issueKeys.has(key)
        ? { type: "link" as const, url: `nexus-issue:${key}`, children: [{ type: "text" as const, value: all }] }
        : false)],
    ], { ignore: [...wikilinkIgnore] });
  };
}

export interface PendingBlock { start: number; end: number; changeId: string; state: string }

interface PreviewData {
  slugByLine: Map<number, string>;
  targetSlug: string | null;
  pending: PendingBlock[];
  notes: readonly string[];
  /** The open note, so a shared name resolves to the closest note (backlinks-completion 1.2). */
  from: string | null;
  /** A zero-based source line to mark, from a backlink (backlinks-completion 2.2). */
  targetLine: number | null;
}
// Renderers are module-level and stable, so React never remounts the DOM nodes
// (a remount would drop focus from a highlighted change). Data flows through context.
const PreviewContext = createContext<PreviewData>({ slugByLine: new Map(), targetSlug: null, pending: [], notes: [], from: null, targetLine: null });

type NodeProps = { node?: { position?: { start: { line: number }; end?: { line: number } } }; children?: ReactNode; className?: string };

function HeadingRenderer({ tag: Tag, node, children }: NodeProps & { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" }) {
  const { slugByLine, targetSlug, targetLine } = useContext(PreviewContext);
  const slug = slugByLine.get(node?.position?.start.line ?? -1);
  const isTarget = slug !== undefined && slug === targetSlug;
  const isLine = targetLine !== null && (node?.position?.start.line ?? -1) - 1 === targetLine;
  const classes = [isTarget ? "heading-target" : null, isLine ? "line-target" : null].filter(Boolean).join(" ") || undefined;
  return (
    <Tag id={slug ? `h-${slug}` : undefined} tabIndex={isTarget || isLine ? -1 : undefined} className={classes} data-heading-slug={slug}>
      {children}
      {isTarget ? <span className="target-label">Linked heading</span> : null}
    </Tag>
  );
}

function BlockRenderer({ tag: Tag, node, children, className }: NodeProps & { tag: "li" | "p" }) {
  const { pending, targetLine } = useContext(PreviewContext);
  const line = node?.position?.start.line;
  const end = node?.position?.end?.line ?? line;
  const hit = line === undefined ? undefined : pending.find((b) => line - 1 >= b.start && line - 1 <= b.end);
  // A list item is the passage when its own first line holds the link; a paragraph when any of its lines does.
  const isLine = targetLine !== null && line !== undefined && (Tag === "li" ? line - 1 === targetLine : line - 1 <= targetLine && targetLine <= (end ?? line) - 1);
  const classes = [className, hit ? "pending-block" : null, hit?.state === "conflicted" ? "conflicted" : null, isLine ? "line-target" : null].filter(Boolean).join(" ") || undefined;
  return (
    <Tag className={classes} data-change-id={hit?.changeId} tabIndex={hit || isLine ? -1 : undefined}>
      {children}
      {hit ? <span className="pending-badge">{hit.state === "conflicted" ? "Conflict" : "Pending review"}</span> : null}
      {isLine ? <span className="target-label">Linked passage</span> : null}
    </Tag>
  );
}

const noteName = (p: string) => p.replace(/\.md$/i, "");

function LinkRenderer({ href, children }: { href?: string; children?: ReactNode }) {
  const { notes, from } = useContext(PreviewContext);
  if (href?.startsWith("nexus-note:")) {
    const [rawName = "", rawHeading] = href.slice("nexus-note:".length).split("#");
    const name = decodeURIComponent(rawName);
    const r = resolveNoteTarget(name, notes, from);
    if (r.status === "missing") return <span className="broken-link" title="No note with this name">{children}</span>;
    // Several notes are equally close: say so, and do not guess which one was meant.
    if (r.status === "ambiguous") {
      return (
        <span className="broken-link ambiguous-link" title={`Several notes are called “${name}”: ${r.candidates.map(noteName).join(", ")}. Write the folder in the link to choose one.`}>
          {children}<span className="link-flag"> (ambiguous link)</span>
        </span>
      );
    }
    return <Link to={notePathParam(r.path, rawHeading ? slugOf(decodeURIComponent(rawHeading)) : null)}>{children}</Link>;
  }
  if (href?.startsWith("nexus-issue:")) return <Link to={`/issues/${href.slice("nexus-issue:".length)}`} className="issue-mention">{children}</Link>;
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
}

const components: Components = {
  h1: (p) => <HeadingRenderer tag="h1" {...p} />,
  h2: (p) => <HeadingRenderer tag="h2" {...p} />,
  h3: (p) => <HeadingRenderer tag="h3" {...p} />,
  h4: (p) => <HeadingRenderer tag="h4" {...p} />,
  h5: (p) => <HeadingRenderer tag="h5" {...p} />,
  h6: (p) => <HeadingRenderer tag="h6" {...p} />,
  li: (p) => <BlockRenderer tag="li" {...p} />,
  p: (p) => <BlockRenderer tag="p" {...p} />,
  a: (p) => <LinkRenderer href={p.href}>{p.children}</LinkRenderer>,
};

const urlTransform = (url: string) => (url.startsWith("nexus-note:") || url.startsWith("nexus-issue:") ? url : defaultUrlTransform(url));

export function MarkdownPreview({ content, notes, issueKeys, targetSlug, pending = [], path = null, targetLine = null }: {
  content: string;
  notes: readonly string[];
  issueKeys: ReadonlySet<string>;
  targetSlug: string | null;
  /** Zero-based source line ranges of changes awaiting review. */
  pending?: PendingBlock[];
  /** The note being shown, for resolving shared names to the closest note. */
  path?: string | null;
  /** A zero-based source line to mark as the linked passage. */
  targetLine?: number | null;
}) {
  const slugByLine = useMemo(() => new Map(parseHeadings(content).map((h) => [h.line + 1, h.slug])), [content]);
  const data = useMemo(() => ({ slugByLine, targetSlug, pending, notes, from: path, targetLine }), [slugByLine, targetSlug, pending, notes, path, targetLine]);
  const plugins = useMemo(() => [remarkGfm, [remarkNexusLinks, { issueKeys }]] as NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]>, [issueKeys]);
  return (
    <PreviewContext.Provider value={data}>
      <div className="preview">
        <Markdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>{content}</Markdown>
      </div>
    </PreviewContext.Provider>
  );
}
