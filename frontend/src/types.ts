export type NoteStatus = "folded" | "active" | "done";

// 'plain' is a raw brain-dump line; 'loop' is a designed note with
// steps. See docs/IA.md ("Brain dump" / "Loop design").
export type NoteKind = "plain" | "loop";

// Recurrence rule, set in Loop design. See docs/IA.md ("Recurrence").
export type NoteRecurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface Note {
  id: string;
  parent_id: string | null;
  text: string;
  x: number;
  y: number;
  status: NoteStatus;
  kind: NoteKind;
  recurrence: NoteRecurrence;
  created_at: string;
}

export interface CompleteResponse {
  note: Note;
  promoted_sibling: Note | null;
  parent: Note | null;
}

export interface CrackOpenResponse {
  parent: Note;
  active_child: Note;
}

// The Loop design step-proposer's two response shapes. Preview only —
// committing happens via crack-open. See docs/IA.md ("Loop design").
export type DecomposeProposal =
  | { type: "steps"; steps: string[] }
  | { type: "skip"; suggestion: string };
