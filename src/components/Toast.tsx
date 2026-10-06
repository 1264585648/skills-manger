import type { ToastMessage } from "../hooks/useWorkspace";
import { IconCheckCircle, IconInfoCircle, IconAlertCircle, IconClose } from "./icons";

interface Props {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="系统通知">
      {toasts.map((toast) => {
        const icon =
          toast.type === "success" ? (
            <IconCheckCircle className="toast-icon toast-icon-success" />
          ) : toast.type === "warning" ? (
            <IconAlertCircle className="toast-icon toast-icon-warning" />
          ) : toast.type === "error" ? (
            <IconAlertCircle className="toast-icon toast-icon-error" />
          ) : (
            <IconInfoCircle className="toast-icon toast-icon-info" />
          );

        return (
          <div
            key={toast.id}
            className={`toast-card toast-${toast.type}`}
            role={toast.type === "error" ? "alert" : "status"}
          >
            <div className="toast-icon-wrap">{icon}</div>
            <div className="toast-content">
              {toast.title ? <strong className="toast-title">{toast.title}</strong> : null}
              <p className="toast-message">{toast.message}</p>
            </div>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭通知"
            >
              <IconClose />
            </button>
          </div>
        );
      })}
    </div>
  );
}
