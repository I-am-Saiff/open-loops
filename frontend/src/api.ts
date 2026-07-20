import type { CompleteResponse, CrackOpenResponse, Note } from "./types";

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
