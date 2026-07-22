import type { CompleteResponse, CrackOpenResponse, DecomposeProposal, Note } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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

export function crackOpen(id: string, steps: string[]): Promise<CrackOpenResponse> {
  return request<CrackOpenResponse>(`/notes/${id}/crack-open`, {
    method: "PATCH",
    body: JSON.stringify({ steps }),
  });
}

export function completeNote(id: string): Promise<CompleteResponse> {
  return request<CompleteResponse>(`/notes/${id}/complete`, {
    method: "PATCH",
  });
}

export function decompose(id: string): Promise<DecomposeProposal> {
  return request<DecomposeProposal>(`/notes/${id}/decompose`, {
    method: "POST",
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
export async function dissolveNote(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notes/${id}`, { method: "DELETE" });
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
