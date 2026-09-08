use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

pub(crate) fn default_user_skills_root(home: &Path) -> PathBuf {
    home.join(".claude").join("skills")
}

pub(crate) fn current_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

pub(crate) fn find_executable(path_value: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_value).find_map(find_claude_in_directory)
}

fn find_claude_in_directory(directory: PathBuf) -> Option<PathBuf> {
    #[cfg(windows)]
    const CANDIDATES: &[&str] = &["claude.exe", "claude.cmd", "claude.bat", "claude"];
    #[cfg(not(windows))]
    const CANDIDATES: &[&str] = &["claude"];

    CANDIDATES.iter().find_map(|candidate| {
        let path = directory.join(candidate);
        if path.is_file() {
            path.canonicalize().ok()
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{default_user_skills_root, find_executable};

    #[test]
    fn default_user_root_uses_supplied_home() {
        let home = PathBuf::from("C:/Users/tester");
        assert_eq!(
            default_user_skills_root(&home),
            home.join(".claude").join("skills")
        );
    }

    #[test]
    fn path_search_finds_platform_claude_executable() {
        let test_directory =
            std::env::temp_dir().join(format!("skills-manger-claude-path-{}", std::process::id()));
        let first = test_directory.join("first");
        let second = test_directory.join("second");
        fs::create_dir_all(&first).expect("first PATH directory should exist");
        fs::create_dir_all(&second).expect("second PATH directory should exist");
        let executable = second.join(if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        });
        fs::write(&executable, []).expect("executable fixture should write");
        let joined = std::env::join_paths([first, second]).expect("PATH should join");

        let found = find_executable(&joined).expect("Claude executable should be found");
        assert_eq!(
            found,
            executable
                .canonicalize()
                .expect("fixture should canonicalize")
        );

        let _ = fs::remove_dir_all(test_directory);
    }
}
