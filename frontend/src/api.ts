import type { CompleteResponse, Message, Note } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Global in-flight tracker. Every network call routes through the two
// fetch wrappers below, so subscribing here catches ALL of them — the
// on-load list, note saves, classify, decompose/thread, advance — with
// no per-handler wiring. The UI uses this to show a subtle "working"
// indicator so a slow request (a cold backend, or a Groq call) never
// looks frozen. See docs/DECISIONS.md ("Loading indicator").
let inFlight = 0;
type BusyListener = (busy: boolean) => void;
const busyListeners = new Set<BusyListener>();

export function subscribeBusy(listener: BusyListener): () => void {
  busyListeners.add(listener);
  listener(inFlight > 0);
  return () => {
    busyListeners.delete(listener);
  };
}

// Only notify on the false<->true edge — overlapping requests keep the
// indicator steady rather than flickering it per request.
function changeInFlight(delta: number): void {
  const wasBusy = inFlight > 0;
  inFlight += delta;
  const isBusy = inFlight > 0;
  if (wasBusy !== isBusy) {
    for (const listener of busyListeners) listener(isBusy);
  }
}

async function trackedFetch(input: string, init?: RequestInit): Promise<Response> {
  changeInFlight(1);
  try {
    return await fetch(input, init);
  } finally {
    changeInFlight(-1);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await trackedFetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function listNotes(): Promise<Note[]> {
  return request<Note[]>("/notes");
}

export function createNote(input: {
  text: string;
  x: number;
  y: number;
  parent_id?: string;
}): Promise<Note> {
  return request<Note>("/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Notebook first — recognition, not conversation. Called after a note
// saves (never blocking the save); best-effort on the backend, so a
// failure just means no whisper. See docs/DECISIONS.md.
export function classifyNote(id: string): Promise<Note> {
  return request<Note>(`/notes/${id}/classify`, { method: "POST" });
}

export function updateNoteText(id: string, text: string): Promise<Note> {
  return request<Note>(`/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

export function completeNote(id: string): Promise<CompleteResponse> {
  return request<CompleteResponse>(`/notes/${id}/complete`, {
    method: "PATCH",
  });
}

export function peekNote(id: string): Promise<Note> {
  return request<Note>(`/notes/${id}/peek`, { method: "PATCH" });
}

export function keepNote(id: string): Promise<Note> {
  return request<Note>(`/notes/${id}/keep`, { method: "PATCH" });
}

// Not routed through request<T> — DELETE returns 204 with no body, and
// request<T> always calls res.json(), which would throw on an empty body.
// Still goes through trackedFetch so the busy indicator covers erases.
export async function dissolveNote(id: string): Promise<void> {
  const res = await trackedFetch(`${API_BASE}/notes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
}

export function linkNotes(id: string, otherNoteId: string): Promise<Note> {
  return request<Note>(`/notes/${id}/link`, {
    method: "PATCH",
    body: JSON.stringify({ other_note_id: otherNoteId }),
  });
}

// Chat thread — see docs/DECISIONS.md ("Chat thread: schema and orchestration").

export function listMessages(noteId: string): Promise<Message[]> {
  return request<Message[]>(`/notes/${noteId}/messages`);
}

export function startThread(noteId: string): Promise<Message[]> {
  return request<Message[]>(`/notes/${noteId}/thread/start`, { method: "POST" });
}

export function advanceThread(noteId: string): Promise<Message[]> {
  return request<Message[]>(`/notes/${noteId}/thread/advance`, { method: "PATCH" });
}

export function sendThreadMessage(noteId: string, text: string): Promise<Message[]> {
  return request<Message[]>(`/notes/${noteId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function manualFirstStep(noteId: string, text: string): Promise<Message[]> {
  return request<Message[]>(`/notes/${noteId}/thread/manual-step`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function dismissMessage(messageId: string): Promise<Message> {
  return request<Message>(`/messages/${messageId}/dismiss`, { method: "PATCH" });
}
