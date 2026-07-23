import { useState } from "react";
import type { Message, Note } from "./types";

interface Props {
  loop: Note;
  messages: Message[];
  notes: Note[];
  readOnly: boolean;
  onAdvance: () => void;
  onSendMessage: (text: string) => void;
  onAcceptSkip: () => void;
  onDeclineSkip: (manualStepText: string) => void;
  onKeepStale: () => void;
  onDropStale: () => void;
  onAcceptMerge: (newNoteId: string, existingNoteId: string) => void;
  onDeclineMerge: (messageId: string) => void;
  onClose: () => void;
}

// Walks backward from a merge_prompt to the 'step' message it was
// attached to (always the immediately preceding message — see
// threads.py's start_thread) to find which real note is the "new" side
// of the link. See docs/DECISIONS.md ("Feature C, in-thread").
function findPrecedingStepNoteId(messages: Message[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].kind === "step" && messages[i].related_note_id) {
      return messages[i].related_note_id;
    }
  }
  return null;
}

// One loop = one persistent chat thread. Messages render in order, oldest
// first, scrollable — "scroll up to see everything" is just normal
// document flow, not a special mode. See docs/DECISIONS.md ("Major
// redesign: chat thread replaces the step-list UI").
export function ChatThread({
  loop,
  messages,
  notes,
  readOnly,
  onAdvance,
  onSendMessage,
  onAcceptSkip,
  onDeclineSkip,
  onKeepStale,
  onDropStale,
  onAcceptMerge,
  onDeclineMerge,
  onClose,
}: Props) {
  const [inputText, setInputText] = useState("");
  const [decliningSkip, setDecliningSkip] = useState(false);
  const [manualStepText, setManualStepText] = useState("");

  // Checked against the loop's actual current active child, not just
  // "was the last message a step" — asking "what's the full plan?"
  // appends a user_reply + summary after the step message, and the Done
  // button needs to keep showing through that, not just on a message
  // that happens to be last. Also means it quietly disappears if a
  // background refresh already completed this step some other way (a
  // Feature C cascade from another loop), instead of double-firing.
  const activeStepNote = notes.find((n) => n.parent_id === loop.id && n.status === "active");
  const showDoneButton = !readOnly && activeStepNote !== undefined;

  // Same reasoning as showDoneButton: check the loop's real state (still
  // folded, never cracked open, but a skip was proposed) rather than
  // "was the last message a skip_prompt" — asking for the full plan
  // before deciding on it would otherwise bury the accept/decline
  // buttons under the summary reply with no way back to them.
  const isUnresolvedSkip =
    loop.status === "folded" && messages.some((m) => m.kind === "skip_prompt");
  const showSkipActions = !readOnly && isUnresolvedSkip && !decliningSkip;

  function submitText() {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputText("");
  }

  function submitManualStep() {
    const trimmed = manualStepText.trim();
    if (!trimmed) return;
    onDeclineSkip(trimmed);
    setManualStepText("");
    setDecliningSkip(false);
  }

  return (
    <div className="chat-thread" onPointerDown={(e) => e.stopPropagation()}>
      <div className="chat-thread__header">
        <span className="chat-thread__title">{loop.text}</span>
        <button type="button" className="chat-thread__close" onClick={onClose} aria-label="close thread">
          ×
        </button>
      </div>

      <div className="chat-thread__messages">
        {messages.map((m, i) => (
          <div key={m.id}>
            <div className={`chat-bubble chat-bubble--${m.sender}`}>{m.text}</div>

            {m.kind === "stale_prompt" && !m.resolved && !readOnly && (
              <div className="chat-thread__reply-actions">
                <button type="button" onClick={onKeepStale}>
                  keep it
                </button>
                <button type="button" className="note-card__action--quiet" onClick={onDropStale}>
                  let it go
                </button>
              </div>
            )}

            {m.kind === "merge_prompt" && !m.resolved && !readOnly && m.related_note_id && (
              <div className="chat-thread__reply-actions">
                <button
                  type="button"
                  onClick={() => {
                    const newNoteId = findPrecedingStepNoteId(messages, i);
                    if (newNoteId) onAcceptMerge(newNoteId, m.related_note_id!);
                  }}
                >
                  link them
                </button>
                <button
                  type="button"
                  className="note-card__action--quiet"
                  onClick={() => onDeclineMerge(m.id)}
                >
                  no thanks
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showDoneButton && (
        <button type="button" className="chat-thread__done-btn" onClick={onAdvance}>
          done
        </button>
      )}

      {showSkipActions && (
        <div className="chat-thread__reply-actions">
          <button type="button" onClick={onAcceptSkip}>
            sounds good, close it out
          </button>
          <button
            type="button"
            className="note-card__action--quiet"
            onClick={() => setDecliningSkip(true)}
          >
            actually, let&rsquo;s break it down
          </button>
        </div>
      )}

      {decliningSkip && (
        <div className="chat-thread__manual-input">
          <input
            autoFocus
            value={manualStepText}
            placeholder="what's the first thing to do?"
            onChange={(e) => setManualStepText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitManualStep()}
          />
          <button type="button" onClick={submitManualStep}>
            go
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="chat-thread__input">
          <input
            value={inputText}
            placeholder="ask “what’s the full plan?”…"
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitText()}
          />
          <button type="button" onClick={submitText}>
            send
          </button>
        </div>
      )}
    </div>
  );
}
