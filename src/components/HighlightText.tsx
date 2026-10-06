import type { ReactNode } from "react";

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
}

export function HighlightText({ text, query, className = "" }: HighlightTextProps): ReactNode {
  if (!text) return null;
  const trimmed = query.trim();
  if (!trimmed) return <span className={className}>{text}</span>;

  try {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);

    return (
      <span className={className}>
        {parts.map((part, index) =>
          regex.test(part) ? (
            <mark key={index} className="search-highlight">
              {part}
            </mark>
          ) : (
            part
          ),
        )}
      </span>
    );
  } catch {
    return <span className={className}>{text}</span>;
  }
}
