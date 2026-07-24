export type PageId = "v1" | "v2" | "v3" | "v4";

export const PAGES: { id: PageId; label: string }[] = [
  { id: "v1", label: "v1 — companion" },
  { id: "v2", label: "v2 — ink" },
  { id: "v3", label: "v3 — dice" },
  { id: "v4", label: "v4 — fade" },
];

interface Props {
  current: PageId;
  onChange: (page: PageId) => void;
}

// Notebook index tabs sticking out of the right edge of the page — the
// four versions are literally four pages of the same notebook, so the
// switcher is drawn as the thing you'd actually grab to flip between
// them, not a navbar. See docs/DECISIONS.md ("Version gallery").
export function PageTabs({ current, onChange }: Props) {
  return (
    <nav className="page-tabs" aria-label="notebook pages">
      {PAGES.map((page) => (
        <button
          key={page.id}
          type="button"
          className={`page-tab${page.id === current ? " page-tab--current" : ""}`}
          onClick={() => onChange(page.id)}
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}
