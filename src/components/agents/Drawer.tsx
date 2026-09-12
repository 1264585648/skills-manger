import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X, MoreHorizontal, LoaderCircle } from "lucide-react";

export function Drawer({
  title,
  subtitle,
  onClose,
  busy = false,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="ux-drawer"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button
          className="ux-icon"
          aria-label="关闭面板"
          title="关闭"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div className="ux-drawer-body">{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </dialog>
  );
}
export function Menu({
  label = "更多",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && ref.current)
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      ref={ref}
      className="ux-menu"
      onToggle={(e) => {
        if (e.currentTarget.open) {
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({
            top: Math.min(rect.bottom + 5, window.innerHeight - 180),
            left: Math.max(8, rect.right - 185),
          });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <MoreHorizontal size={19} />
      </summary>
      <div
        role="menu"
        style={position}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button") && ref.current)
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function InlineError({
  message,
  retry,
}: {
  message: string | null;
  retry?: () => void;
}) {
  return message ? (
    <div className="ux-error" role="alert">
      <span>{message}</span>
      {retry ? (
        <button className="ux-link" onClick={retry}>
          重试
        </button>
      ) : null}
    </div>
  ) : null;
}
export function Loading({ text = "正在读取" }: { text?: string }) {
  return (
    <div className="ux-empty" role="status">
      <LoaderCircle className="ac-spin" size={23} />
      <span>{text}</span>
    </div>
  );
}
