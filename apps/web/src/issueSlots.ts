// Extension point on the issue page (B5 pending-change markers).
import type { ComponentType } from "react";
import type { IssueView } from "@nexus/schema";

export const extraIssue: { aboveFields: ComponentType<{ issue: IssueView }>[] } = { aboveFields: [] };
