// Registers the review slice with the shell's extension points.
import { extraShell } from "../slices";
import { extraHome } from "../homeSlots";
import { extraIssue } from "../issueSlots";
import { ReviewBar } from "./ReviewBar";
import { DemoSection } from "./DemoSection";
import { IssuePending } from "./IssuePending";

extraShell.overlays.push(ReviewBar);
extraShell.eventHandlers.push((event, client) => {
  if (event.type === "review.updated") void client.invalidateQueries({ queryKey: ["review"] });
});
extraHome.sections.push(DemoSection);
extraIssue.aboveFields.push(IssuePending);
