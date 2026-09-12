#[cfg(test)]
use std::path::Path;
use std::{ffi::OsStr, path::PathBuf};

#[cfg(test)]
pub(crate) fn default_user_skills_roots(home: &Path) -> [PathBuf; 2] {
    [
        home.join(".codex").join("skills"),
        home.join(".agents").join("skills"),
    ]
}

pub(crate) fn find_executable(path_value: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_value).find_map(find_codex_in_directory)
}

fn find_codex_in_directory(directory: PathBuf) -> Option<PathBuf> {
    #[cfg(windows)]
    const CANDIDATES: &[&str] = &["codex.exe", "codex.cmd", "codex.bat", "codex"];
    #[cfg(not(windows))]
    const CANDIDATES: &[&str] = &["codex"];

    CANDIDATES.iter().find_map(|candidate| {
        let path = directory.join(candidate);
        path.is_file().then(|| path.canonicalize().ok()).flatten()
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{default_user_skills_roots, find_executable};

    #[test]
    fn user_roots_are_bounded_to_codex_and_agent_skills() {
        let home = PathBuf::from("C:/Users/tester");
        assert_eq!(
            default_user_skills_roots(&home),
            [
                home.join(".codex").join("skills"),
                home.join(".agents").join("skills")
            ]
        );
    }

    #[test]
    fn path_search_finds_platform_codex_executable_without_running_it() {
        let test_directory =
            std::env::temp_dir().join(format!("skills-manger-codex-path-{}", std::process::id()));
        fs::create_dir_all(&test_directory).expect("PATH directory should exist");
        let executable = test_directory.join(if cfg!(windows) { "codex.exe" } else { "codex" });
        fs::write(&executable, []).expect("executable fixture should write");
        let joined = std::env::join_paths([&test_directory]).expect("PATH should join");

        assert_eq!(
            find_executable(&joined).expect("Codex should be detected"),
            executable
                .canonicalize()
                .expect("fixture should canonicalize")
        );
        let _ = fs::remove_dir_all(test_directory);
    }
}
