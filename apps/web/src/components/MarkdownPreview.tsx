import { useMemo, type ReactNode } from "react";
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

export function MarkdownPreview({ content, notes, issueKeys, targetSlug }: {
  content: string;
  notes: readonly string[];
  issueKeys: ReadonlySet<string>;
  targetSlug: string | null;
}) {
  const slugByLine = useMemo(() => new Map(parseHeadings(content).map((h) => [h.line + 1, h.slug])), [content]);
  const components = useMemo<Components>(() => {
    const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      function HeadingWithId({ node, children }: { node?: { position?: { start: { line: number } } }; children?: ReactNode }) {
        const slug = slugByLine.get(node?.position?.start.line ?? -1);
        const isTarget = slug !== undefined && slug === targetSlug;
        return (
          <Tag id={slug ? `h-${slug}` : undefined} tabIndex={isTarget ? -1 : undefined} className={isTarget ? "heading-target" : undefined}
            data-heading-slug={slug}>
            {children}
            {isTarget ? <span className="target-label">Linked heading</span> : null}
          </Tag>
        );
      };
    return {
      h1: heading("h1"), h2: heading("h2"), h3: heading("h3"), h4: heading("h4"), h5: heading("h5"), h6: heading("h6"),
      a({ href, children }) {
        if (href?.startsWith("nexus-note:")) {
          const [rawName = "", rawHeading] = href.slice("nexus-note:".length).split("#");
          const path = resolveNoteName(decodeURIComponent(rawName), notes);
          if (!path) return <span className="broken-link" title="No note with this name">{children}</span>;
          return <Link to={notePathParam(path, rawHeading ? slugOf(decodeURIComponent(rawHeading)) : null)}>{children}</Link>;
        }
        if (href?.startsWith("nexus-issue:")) return <Link to={`/issues/${href.slice("nexus-issue:".length)}`} className="issue-mention">{children}</Link>;
        return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
      },
    };
  }, [slugByLine, targetSlug, notes]);

  return (
    <div className="preview">
      <Markdown
        remarkPlugins={[remarkGfm, [remarkNexusLinks, { issueKeys }]]}
        components={components}
        urlTransform={(url) => (url.startsWith("nexus-note:") || url.startsWith("nexus-issue:") ? url : defaultUrlTransform(url))}
      >
        {content}
      </Markdown>
    </div>
  );
}
