import { STATUS_LABELS, type EventKind, type Status } from "@/lib/applications/types";

/** One plain sentence for each kind of event, for the timeline. */
export function describeEvent(e: {
  kind: EventKind;
  fromStatus: Status | null;
  toStatus: Status | null;
  note: string | null;
}): string {
  switch (e.kind) {
    case "created":
      return `Added to your pipeline as ${STATUS_LABELS[e.toStatus!]}.`;
    case "status_changed":
      return `Moved from ${STATUS_LABELS[e.fromStatus!]} to ${STATUS_LABELS[e.toStatus!]}.`;
    case "note":
      return "You added a note.";
    case "followed_up":
      return "You recorded that you followed up.";
    case "follow_up_set":
      return e.note === "cleared"
        ? "You cleared the follow-up date."
        : `You set a follow-up date for ${e.note}.`;
    case "documents_linked":
      return "You changed the documents linked to this application.";
  }
}
