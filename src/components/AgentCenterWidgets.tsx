import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, ShieldCheck, X } from "lucide-react";
import type { Diagnostic } from "../types/agentCenter";
import iconManifest from "../data/agentIcons.json";
const icons: Record<string, string> = iconManifest;
export function ProductIcon({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`ac-product-icon product-${id}`}>
      {icons[id] && !failed ? (
        <img src={icons[id]} alt="" onError={() => setFailed(true)} />
      ) : (
        <Bot size={21} />
      )}
    </span>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="ac-icon-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`ac-pill ac-${tone}`}>{children}</span>;
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialog) {
        const items = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog)
        ) {
          last?.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first?.focus();
          event.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="ac-overlay">
      <div
        className={`ac-modal ${wide ? "ac-modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
export function DiagnosticList({
  issues,
  compact = false,
}: {
  issues: Diagnostic[];
  compact?: boolean;
}) {
  const groups = new Map<string, Diagnostic[]>();
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return (
    <div className="ac-diagnostics">
      {[...groups.entries()].map(([key, values]) => (
        <details key={key}>
          <summary>
            <AlertCircle size={16} />
            <span>{values[0].message}</span>
            <Pill tone="amber">{values.length}</Pill>
          </summary>
          <p>{values[0].suggestion}</p>
          {values.map((value, index) => (
            <code key={`${value.path}-${index}`}>{value.path}</code>
          ))}
        </details>
      ))}
      {!issues.length && !compact ? (
        <div className="ac-empty">
          <ShieldCheck size={32} />
          <strong>未发现需要处理的问题</strong>
        </div>
      ) : null}
    </div>
  );
}
