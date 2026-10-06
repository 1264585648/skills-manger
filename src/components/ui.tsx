import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode, RefObject } from "react";
import { IconClose } from "./icons";

type Tone = "green" | "amber" | "red" | "blue" | "gray" | "purple";

export function Button({
  children,
  className = "",
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={`button button-${variant} ${className}`.trim()}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusPill({
  children,
  tone = "gray",
  dot = true,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`status-pill status-${tone}`}>
      {dot ? <span className={`status-pill-dot status-pill-dot-${tone}`} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  title,
  ariaLabel,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={`toggle-switch ${checked ? "toggle-switch-on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
    >
      <span className="toggle-switch-thumb" />
    </button>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <span className="search-field">
      <span className="search-icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="清空搜索"
          onClick={() => {
            onChange("");
            inputRef?.current?.focus();
          }}
        >
          ×
        </button>
      ) : (
        <kbd className="search-kbd">/</kbd>
      )}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">◇</div>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
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
          <button
            type="button"
            className="notice-action"
            onClick={() => setExpanded((value) => !value)}
          >
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
