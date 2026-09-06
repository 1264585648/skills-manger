import type { Environment } from "../types/domain";

const demoEnvironment: Environment = {
  id: "java-backend",
  name: "Java 后端 AI 环境",
  description: "面向后端开发的 Agent 工作环境",
  agents: ["Claude Code"],
  skills: 12,
  updatedAt: "2026-09-06",
};

export function HomePage() {
  return (
    <section className="page-grid">
      <div className="panel">
        <h1>我的 AI 环境</h1>
        <p>{demoEnvironment.description}</p>
        <h2>{demoEnvironment.name}</h2>
        <p>Agent: {demoEnvironment.agents.join(", ")}</p>
        <p>Skills: {demoEnvironment.skills}</p>
      </div>
      <div className="panel">
        <h2>最近变化</h2>
        <p>Skill 更新、部署状态和风险信息将在这里展示。</p>
      </div>
    </section>
  );
}
