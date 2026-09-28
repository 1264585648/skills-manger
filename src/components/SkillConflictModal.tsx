import { useState } from "react";
import { Button, Modal } from "./ui";
import { displayPath, shortHash, type SkillEntry } from "../types/domain";

interface Props {
  entry: SkillEntry | null;
  onClose: () => void;
  onKeepOne: (skillName: string, winnerPath: string) => void;
  onFork: (sourcePath: string, newName: string) => void;
  agentName: (agentId: string) => string;
  busy: boolean;
}

export function SkillConflictModal({
  entry,
  onClose,
  onKeepOne,
  onFork,
  agentName,
  busy,
}: Props) {
  const [forkSourcePath, setForkSourcePath] = useState<string | null>(null);
  const [forkNewName, setForkNewName] = useState("");

  if (!entry) return null;

  const handleStartFork = (path: string) => {
    setForkSourcePath(path);
    setForkNewName(`${entry.name}-copy`);
  };

  const handleConfirmFork = () => {
    if (!forkSourcePath || !forkNewName.trim()) return;
    onFork(forkSourcePath, forkNewName.trim());
    setForkSourcePath(null);
    setForkNewName("");
  };

  return (
    <Modal
      open={Boolean(entry)}
      onClose={onClose}
      title={`技能冲突裁决与合并 · ${entry.name}`}
    >
      <div className="conflict-modal-content">
        <p className="conflict-modal-tip">
          检测到不同 Agent 目录下存在同名但<strong>内容不一致</strong>（代码或配置有差异）的技能副本。请选择保留哪一份作为中央库的唯一标准母本，被覆盖的版本将自动安全备份至 Central Vault 的 <code>.archive/</code> 目录，绝不丢失。
        </p>

        <div className="conflict-instance-list">
          {entry.conflictInstances.map((instance) => {
            const isCurrentViewing = instance.path === entry.path;
            const isForking = forkSourcePath === instance.path;

            return (
              <div
                className={`conflict-instance-card ${isCurrentViewing ? "conflict-instance-active" : ""}`}
                key={instance.id}
              >
                <div className="conflict-instance-head">
                  <span className="conflict-agent-badge">
                    {agentName(instance.agentId)}
                  </span>
                  <span className="conflict-hash-badge" title={instance.contentHash}>
                    Hash: {shortHash(instance.contentHash)}
                  </span>
                </div>

                <div className="conflict-instance-body">
                  <div className="conflict-path-row" title={instance.path}>
                    {displayPath(instance.path)}
                  </div>
                  <div className="conflict-meta-row">
                    <span>脚本数: {instance.scriptCount}</span>
                    <span>状态: {instance.state}</span>
                  </div>
                  {instance.description ? (
                    <p className="conflict-desc-row">{instance.description}</p>
                  ) : null}
                </div>

                {isForking ? (
                  <div className="conflict-fork-row">
                    <input
                      className="conflict-fork-input"
                      value={forkNewName}
                      onChange={(e) => setForkNewName(e.target.value)}
                      placeholder="输入新的技能名称"
                      disabled={busy}
                    />
                    <Button
                      variant="primary"
                      disabled={busy || !forkNewName.trim()}
                      onClick={handleConfirmFork}
                    >
                      确认分叉
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setForkSourcePath(null)}
                    >
                      取消
                    </Button>
                  </div>
                ) : (
                  <div className="conflict-instance-actions">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => onKeepOne(entry.name, instance.path)}
                      title="保留此版本存入 Central Vault，其他副本被备份并转为软链接"
                    >
                      保留此版本（标准库）
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => handleStartFork(instance.path)}
                      title="以此版本重命名创建独立的全新技能"
                    >
                      分叉另存
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="conflict-modal-footer">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            稍后裁决
          </Button>
        </div>
      </div>
    </Modal>
  );
}
