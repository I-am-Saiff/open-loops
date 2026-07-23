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

export interface CompleteResponse {
  note: Note;
  promoted_sibling: Note | null;
  parent: Note | null;
}

export type MessageSender = "companion" | "user";
export type MessageKind = "step" | "skip_prompt" | "user_reply" | "summary" | "done";

export interface Message {
  id: string;
  note_id: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  related_note_id: string | null;
  created_at: string;
}
