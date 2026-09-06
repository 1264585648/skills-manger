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
