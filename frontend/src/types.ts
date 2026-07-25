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
  // When this note was last "peeked" (Feature B) — naive-UTC ISO string,
  // null if never. Drives the v4 fade page's ink opacity.
  last_peeked_at: string | null;
}

export interface CompleteResponse {
  note: Note;
  promoted_sibling: Note | null;
  parent: Note | null;
}

export type MessageSender = "companion" | "user";
export type MessageKind =
  | "step"
  | "skip_prompt"
  | "user_reply"
  | "summary"
  | "done"
  | "stale_prompt"
  | "merge_prompt"
  // Input classification — see docs/DECISIONS.md:
  | "chat" // companion's reply to not-a-task input; the loop resolves to done
  | "clarify_prompt"; // companion's one question for ambiguous input

export interface Message {
  id: string;
  note_id: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  related_note_id: string | null;
  resolved: boolean;
  created_at: string;
}
