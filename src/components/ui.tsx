import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "green" | "amber" | "red" | "blue" | "gray";

export function Button({ children, className = "", variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={`button button-${variant} ${className}`.trim()} type="button" {...props}>{children}</button>;
}

export function StatusPill({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-field"><span aria-hidden="true">⌕</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button className={`toggle ${checked ? "toggle-on" : ""}`} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span /></button>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><strong>{title}</strong><p>{body}</p></div>;
}

interface ErrorNoticeProps {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "操作失败";

const errorDetail = (error: unknown): string | null => {
  if (error instanceof Error && error.stack) return error.stack;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return null;
    }
  }
  return null;
};

export function ErrorNotice({ error, onRetry, onDismiss }: ErrorNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const message = errorMessage(error);
  const detail = errorDetail(error);
  const payload = detail ? `${message}\n\n${detail}` : message;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      setExpanded(true);
    }
  };

  return (
    <div className="inline-notice notice-error" role="alert">
      <span aria-hidden="true">!</span>
      <div className="notice-body">
        <strong>{message}</strong>
        {detail && expanded ? <pre className="notice-detail">{detail}</pre> : null}
      </div>
      <div className="notice-actions">
        {detail ? (
          <button type="button" className="notice-action" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起详情" : "展开详情"}
          </button>
        ) : null}
        <button type="button" className="notice-action" onClick={() => void copy()}>
          {copied ? "已复制" : "复制详情"}
        </button>
        {onRetry ? (
          <button type="button" className="notice-action" onClick={onRetry}>
            重试
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="notice-action" onClick={onDismiss}>
            忽略
          </button>
        ) : null}
      </div>
    </div>
  );
}
