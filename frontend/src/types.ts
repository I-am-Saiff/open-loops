export type NoteStatus = "folded" | "active" | "done";

export interface Note {
  id: string;
  parent_id: string | null;
  text: string;
  x: number;
  y: number;
  status: NoteStatus;
  created_at: string;
  stale: boolean;
}

export interface CrackOpenResponse {
  parent: Note;
  active_child: Note;
}

export interface CompleteResponse {
  note: Note;
  promoted_sibling: Note | null;
  parent: Note | null;
}

export interface DecomposeStepsProposal {
  type: "steps";
  steps: string[];
}

export interface DecomposeSkipProposal {
  type: "skip";
  suggestion: string;
}

export type DecomposeProposal = DecomposeStepsProposal | DecomposeSkipProposal;
