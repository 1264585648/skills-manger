use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub provider: &'static str,
    pub commands: &'static [&'static str],
    pub user_roots: &'static [&'static str],
    pub project_roots: &'static [&'static str],
    pub preferred_user_root: &'static str,
    pub preferred_project_root: Option<&'static str>,
    pub app_names: &'static [&'static str],
    pub extensions: &'static [&'static str],
    pub docs: &'static str,
    pub verified_at: &'static str,
}

macro_rules! agent {
    ($id:literal,$name:literal,$provider:literal,[$($cmd:literal),*],[$($user:literal),*],[$($project:literal),*],[$($app:literal),*],[$($ext:literal),*],$docs:literal) => {
        AgentDefinition { id:$id,name:$name,provider:$provider,commands:&[$($cmd),*],user_roots:&[$($user),*],project_roots:&[$($project),*],preferred_user_root:[$($user),*][0],preferred_project_root:(&[$($project),*] as &[&str]).first().copied(),app_names:&[$($app),*],extensions:&[$($ext),*],docs:$docs,verified_at:"2026-09-09" }
    };
}

pub static AGENTS: &[AgentDefinition] = &[
    agent!(
        "claude-code",
        "Claude Code",
        "Anthropic",
        ["claude"],
        [".claude/skills"],
        [".claude/skills"],
        ["Claude"],
        ["anthropic.claude-code"],
        "https://code.claude.com/docs/en/skills"
    ),
    agent!(
        "codex",
        "Codex",
        "OpenAI",
        ["codex"],
        [".agents/skills", ".codex/skills"],
        [".agents/skills", ".codex/skills"],
        ["Codex"],
        ["openai.chatgpt"],
        "https://learn.chatgpt.com/docs/build-skills"
    ),
    agent!(
        "cursor",
        "Cursor",
        "Anysphere",
        ["cursor", "cursor-agent"],
        [
            ".cursor/skills",
            ".agents/skills",
            ".claude/skills",
            ".codex/skills"
        ],
        [
            ".cursor/skills",
            ".agents/skills",
            ".claude/skills",
            ".codex/skills"
        ],
        ["Cursor"],
        [],
        "https://cursor.com/docs/skills"
    ),
    agent!(
        "windsurf",
        "Windsurf",
        "Cognition",
        ["windsurf"],
        [".codeium/windsurf/skills", ".agents/skills"],
        [".windsurf/skills", ".agents/skills"],
        ["Windsurf"],
        [],
        "https://docs.devin.ai/desktop/cascade/skills"
    ),
    agent!(
        "github-copilot",
        "GitHub Copilot",
        "GitHub",
        ["copilot"],
        [".copilot/skills", ".agents/skills"],
        [".github/skills", ".agents/skills"],
        [],
        ["github.copilot-chat", "github.copilot"],
        "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills"
    ),
    agent!(
        "gemini-cli",
        "Gemini CLI",
        "Google",
        ["gemini"],
        [".gemini/skills", ".agents/skills"],
        [".gemini/skills", ".agents/skills"],
        [],
        ["google.geminicodeassist"],
        "https://geminicli.com/docs/cli/skills/"
    ),
    agent!(
        "opencode",
        "OpenCode",
        "OpenCode",
        ["opencode"],
        [
            ".config/opencode/skills",
            ".agents/skills",
            ".claude/skills"
        ],
        [".opencode/skills", ".agents/skills", ".claude/skills"],
        ["OpenCode"],
        [],
        "https://opencode.ai/docs/skills/"
    ),
    agent!(
        "openclaw",
        "OpenClaw",
        "OpenClaw",
        ["openclaw"],
        [".openclaw/skills", ".agents/skills"],
        [],
        ["OpenClaw"],
        [],
        "https://docs.openclaw.ai/tools/skills"
    ),
    agent!(
        "cline",
        "Cline",
        "Cline",
        ["cline"],
        [".cline/skills"],
        [".cline/skills"],
        [],
        ["saoudrizwan.claude-dev"],
        "https://docs.cline.bot/customization/skills"
    ),
    agent!(
        "trae",
        "TRAE",
        "ByteDance",
        ["trae"],
        [".trae/skills", ".agents/skills"],
        [".trae/skills", ".agents/skills"],
        ["Trae"],
        [],
        "https://docs.trae.ai/ide/skills"
    ),
    agent!(
        "trae-cn",
        "TRAE CN",
        "字节跳动",
        ["trae-cn", "traecli"],
        [".trae-cn/skills", ".traecli/skills"],
        [".trae/skills", ".traecli/skills"],
        ["Trae CN", "Trae-CN"],
        [],
        "https://docs.trae.cn/ide_skills"
    ),
    agent!(
        "codebuddy",
        "CodeBuddy",
        "腾讯",
        ["codebuddy"],
        [".codebuddy/skills"],
        [".codebuddy/skills"],
        ["CodeBuddy"],
        ["tencent-cloud.coding-copilot"],
        "https://www.codebuddy.ai/docs/cli/skills"
    ),
    agent!(
        "qoder",
        "Qoder",
        "Qoder",
        ["qoder", "qodercli"],
        [".qoder/skills"],
        [".qoder/skills"],
        ["Qoder"],
        [],
        "https://docs.qoder.com/cli/Skills"
    ),
    agent!(
        "qwen-code",
        "Qwen Code",
        "阿里云",
        ["qwen"],
        [".qwen/skills"],
        [".qwen/skills"],
        [],
        [],
        "https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/"
    ),
    agent!(
        "kimi-code",
        "Kimi Code",
        "Moonshot AI",
        ["kimi"],
        [".kimi-code/skills", ".agents/skills"],
        [".kimi-code/skills", ".agents/skills"],
        [],
        [],
        "https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html"
    ),
];

pub fn definition(id: &str) -> Option<&'static AgentDefinition> {
    AGENTS.iter().find(|agent| agent.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_has_fifteen_unique_products_and_official_sources() {
        let ids: std::collections::HashSet<_> = AGENTS.iter().map(|a| a.id).collect();
        assert_eq!(ids.len(), 15);
        assert!(AGENTS
            .iter()
            .all(|a| a.docs.starts_with("https://") && !a.user_roots.is_empty()));
        assert!(definition("trae-cn")
            .unwrap()
            .project_roots
            .contains(&".traecli/skills"));
        assert!(definition("kimi-code")
            .unwrap()
            .user_roots
            .contains(&".kimi-code/skills"));
    }
}
