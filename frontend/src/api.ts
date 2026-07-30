import type {
  CompleteResponse,
  CrackOpenResponse,
  DecomposeProposal,
  Note,
  NoteRecurrence,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Global in-flight tracker. Every network call routes through the fetch
// wrapper below, so subscribing here catches all of them with no
// per-handler wiring — used to show a subtle "working" indicator so a
// slow request (cold backend, or a decompose call) never looks frozen.
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

export function createNote(input: { text: string; x?: number; y?: number }): Promise<Note> {
  return request<Note>("/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNoteText(id: string, text: string): Promise<Note> {
  return request<Note>(`/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

// Loop design's AI touchpoint: propose steps (or a skip). Side-effect
// free — nothing is created until crack-open commits the edited list.
export function decomposeNote(id: string): Promise<DecomposeProposal> {
  return request<DecomposeProposal>(`/notes/${id}/decompose`, { method: "POST" });
}

// Commit the designed step list: the note becomes a loop and moves to
// Open loops with its first step live. An optional recurrence rule makes
// it regenerate at its interval once closed.
export function crackOpen(
  id: string,
  steps: string[],
  recurrence: NoteRecurrence = "none"
): Promise<CrackOpenResponse> {
  return request<CrackOpenResponse>(`/notes/${id}/crack-open`, {
    method: "PATCH",
    body: JSON.stringify({ steps, recurrence }),
  });
}

// Mark the active step done and advance the loop (promote next / close).
export function completeNote(id: string): Promise<CompleteResponse> {
  return request<CompleteResponse>(`/notes/${id}/complete`, { method: "PATCH" });
}

// Not routed through request<T> — DELETE returns 204 with no body, which
// request<T>'s res.json() would choke on. Still tracked for the busy
// indicator.
export async function deleteNote(id: string): Promise<void> {
  const res = await trackedFetch(`${API_BASE}/notes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
}
