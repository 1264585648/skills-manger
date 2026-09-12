import { Folder } from "lucide-react";
import type { ScopeOption } from "../../types/agentCenter";
export function ScopeSelector({
  scopes,
  value,
  onChange,
  onPickProject,
}: {
  scopes: ScopeOption[];
  value: string;
  onChange: (id: string) => void;
  onPickProject: () => void;
}) {
  return (
    <label className="ux-scope">
      <Folder size={15} />
      <span>作用范围</span>
      <select
        aria-label="作用范围"
        value={value}
        onChange={(e) =>
          e.target.value === "pick" ? onPickProject() : onChange(e.target.value)
        }
      >
        {!scopes.some((s) => s.id === value) ? (
          <option value={value}>原项目不可用</option>
        ) : null}
        {scopes.map((s) => (
          <option value={s.id} key={s.id}>
            {s.name}
          </option>
        ))}
        <option value="pick">选择项目…</option>
      </select>
    </label>
  );
}
