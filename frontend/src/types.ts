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
  linked_note_id: string | null;
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

export interface MergeSuggestion {
  new_step: string;
  existing_note_id: string;
  existing_step: string;
}

export interface DecomposeStepsProposal {
  type: "steps";
  steps: string[];
  merge_suggestion: MergeSuggestion | null;
}

export interface DecomposeSkipProposal {
  type: "skip";
  suggestion: string;
}

export type DecomposeProposal = DecomposeStepsProposal | DecomposeSkipProposal;
