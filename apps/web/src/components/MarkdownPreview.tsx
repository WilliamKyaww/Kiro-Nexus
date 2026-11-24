import { createContext, useContext, useMemo, type ReactNode } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";
import { Link } from "react-router";
import { parseHeadings, slugOf } from "@nexus/markdown";
import { notePathParam } from "../api";

const wikilink = /\[\[([^[\]|#\n]+)(?:#([^[\]|\n]+))?(?:\|([^[\]\n]+))?\]\]/g;
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
    ], { ignore: ["link", "linkReference", "inlineCode", "code"] });
  };
}

function resolveNoteName(name: string, notes: readonly string[]): string | null {
  const wanted = name.toLowerCase().replace(/\.md$/, "");
  const exact = notes.find((p) => p.toLowerCase().replace(/\.md$/, "") === wanted);
  if (exact) return exact;
  const byBase = notes.filter((p) => (p.split("/").pop() ?? "").toLowerCase().replace(/\.md$/, "") === wanted);
  return byBase.sort((a, b) => a.split("/").length - b.split("/").length)[0] ?? null;
}

export interface PendingBlock { start: number; end: number; changeId: string; state: string }

interface PreviewData {
  slugByLine: Map<number, string>;
  targetSlug: string | null;
  pending: PendingBlock[];
  notes: readonly string[];
}
// Renderers are module-level and stable, so React never remounts the DOM nodes
// (a remount would drop focus from a highlighted change). Data flows through context.
const PreviewContext = createContext<PreviewData>({ slugByLine: new Map(), targetSlug: null, pending: [], notes: [] });

type NodeProps = { node?: { position?: { start: { line: number } } }; children?: ReactNode; className?: string };

function HeadingRenderer({ tag: Tag, node, children }: NodeProps & { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" }) {
  const { slugByLine, targetSlug } = useContext(PreviewContext);
  const slug = slugByLine.get(node?.position?.start.line ?? -1);
  const isTarget = slug !== undefined && slug === targetSlug;
  return (
    <Tag id={slug ? `h-${slug}` : undefined} tabIndex={isTarget ? -1 : undefined} className={isTarget ? "heading-target" : undefined} data-heading-slug={slug}>
      {children}
      {isTarget ? <span className="target-label">Linked heading</span> : null}
    </Tag>
  );
}

function BlockRenderer({ tag: Tag, node, children, className }: NodeProps & { tag: "li" | "p" }) {
  const { pending } = useContext(PreviewContext);
  const line = node?.position?.start.line;
  const hit = line === undefined ? undefined : pending.find((b) => line - 1 >= b.start && line - 1 <= b.end);
  const classes = [className, hit ? "pending-block" : null, hit?.state === "conflicted" ? "conflicted" : null].filter(Boolean).join(" ") || undefined;
  return (
    <Tag className={classes} data-change-id={hit?.changeId} tabIndex={hit ? -1 : undefined}>
      {children}
      {hit ? <span className="pending-badge">{hit.state === "conflicted" ? "Conflict" : "Pending review"}</span> : null}
    </Tag>
  );
}

function LinkRenderer({ href, children }: { href?: string; children?: ReactNode }) {
  const { notes } = useContext(PreviewContext);
  if (href?.startsWith("nexus-note:")) {
    const [rawName = "", rawHeading] = href.slice("nexus-note:".length).split("#");
    const path = resolveNoteName(decodeURIComponent(rawName), notes);
    if (!path) return <span className="broken-link" title="No note with this name">{children}</span>;
    return <Link to={notePathParam(path, rawHeading ? slugOf(decodeURIComponent(rawHeading)) : null)}>{children}</Link>;
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

export function MarkdownPreview({ content, notes, issueKeys, targetSlug, pending = [] }: {
  content: string;
  notes: readonly string[];
  issueKeys: ReadonlySet<string>;
  targetSlug: string | null;
  /** Zero-based source line ranges of changes awaiting review. */
  pending?: PendingBlock[];
}) {
  const slugByLine = useMemo(() => new Map(parseHeadings(content).map((h) => [h.line + 1, h.slug])), [content]);
  const data = useMemo(() => ({ slugByLine, targetSlug, pending, notes }), [slugByLine, targetSlug, pending, notes]);
  const plugins = useMemo(() => [remarkGfm, [remarkNexusLinks, { issueKeys }]] as NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]>, [issueKeys]);
  return (
    <PreviewContext.Provider value={data}>
      <div className="preview">
        <Markdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>{content}</Markdown>
      </div>
    </PreviewContext.Provider>
  );
}
