use crate::{
    agent_center::{self, ScanController},
    agent_management::*,
    db::Database,
    safe_apply, skills,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
struct Fixture {
    path: PathBuf,
    db: Database,
    library: PathBuf,
    target: PathBuf,
    root: String,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "agent-ux-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let library = path.join("library");
        let target = path.join("workspace/.claude/skills");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&target).unwrap();
        let db = Database::initialize(path.join("db.sqlite")).unwrap();
        agent_center::initialize(&db).unwrap();
        let root = agent_center::register_root(&db, "claude-code", &target, "user", "custom", None)
            .unwrap()
            .id;
        Self {
            path,
            db,
            library,
            target,
            root,
        }
    }
    fn scan(&self) {
        agent_center::scan(
            &self.db,
            &self.library,
            &ScanController::default(),
            None,
            Some(&self.root),
        )
        .unwrap();
    }
    fn import(&self, folder: &str, name: &str, body: &str) -> skills::SkillRecord {
        let p = self.path.join(folder).join(name);
        write_skill(&p, name, body);
        skills::import_skill_directory(&self.db, &self.library, &p)
            .unwrap()
            .skill
    }
    fn view(&self) -> ManagementView {
        management_view(&self.db, "claude-code", "user").unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
fn write_skill(path: &Path, name: &str, body: &str) {
    fs::create_dir_all(path).unwrap();
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: test skill\n---\n{body}"),
    )
    .unwrap();
}

#[test]
fn same_name_does_not_bind_unrelated_library_sources() {
    let f = Fixture::new();
    f.import("one", "demo", "a");
    f.import("two", "demo", "b");
    write_skill(&f.target.join("demo"), "demo", "outside");
    f.scan();
    let v = f.view();
    assert_eq!(v.skills.len(), 1);
    assert!(v.skills[0].library_id.is_none());
    assert!(!v.skills[0].can_update);
}

#[test]
fn ambiguous_custom_targets_require_a_choice_and_preferences_survive_reopen() {
    let f = Fixture::new();
    let other = f.path.join("other/skills");
    fs::create_dir_all(&other).unwrap();
    let second =
        agent_center::register_root(&f.db, "claude-code", &other, "user", "custom", None).unwrap();
    assert!(f.view().target_id.is_none());
    let mut p = preferences(&f.db).unwrap();
    p.last_agent_id = Some("claude-code".into());
    p.targets
        .insert("claude-code:user".into(), second.id.clone());
    save_preferences(&f.db, &p).unwrap();
    let reopened = Database::initialize(f.db.path()).unwrap();
    assert_eq!(
        management_view(&reopened, "claude-code", "user")
            .unwrap()
            .target_id,
        Some(second.id)
    );
}

#[test]
fn project_and_global_scopes_never_mix() {
    let f = Fixture::new();
    write_skill(&f.target.join("global"), "global", "global");
    let project = f.path.join("project/.claude/skills");
    write_skill(&project.join("local"), "local", "project");
    let root =
        agent_center::register_root(&f.db, "claude-code", &project, "project", "native", None)
            .unwrap();
    f.scan();
    agent_center::scan(
        &f.db,
        &f.library,
        &ScanController::default(),
        None,
        Some(&root.id),
    )
    .unwrap();
    let global = f.view();
    assert_eq!(global.skills[0].name, "global");
    let scope = global
        .scopes
        .iter()
        .find(|s| s.root_ids.contains(&root.id))
        .unwrap();
    let local = management_view(&f.db, "claude-code", &scope.id).unwrap();
    assert_eq!(local.skills.len(), 1);
    assert_eq!(local.skills[0].name, "local");
    assert_eq!(local.target_id, Some(root.id));
}

#[test]
fn unavailable_project_retains_context_without_offering_a_global_write_target() {
    let f = Fixture::new();
    let project = f.path.join("project");
    let target = project.join(".claude/skills");
    write_skill(&target.join("demo"), "demo", "project content");
    let root =
        agent_center::register_root(&f.db, "claude-code", &target, "project", "native", None)
            .unwrap();
    agent_center::scan(
        &f.db,
        &f.library,
        &ScanController::default(),
        None,
        Some(&root.id),
    )
    .unwrap();
    let scope = f
        .view()
        .scopes
        .into_iter()
        .find(|s| s.root_ids.contains(&root.id))
        .unwrap();
    fs::rename(&project, f.path.join("offline")).unwrap();
    let view = management_view(&f.db, "claude-code", &scope.id).unwrap();
    assert!(!view.scope_available);
    assert!(view.targets.is_empty());
    assert_eq!(view.scope_id, scope.id);
    assert_eq!(view.skills[0].state, "unverified");
    assert!(!project.exists());
}

#[test]
fn updating_a_bound_nested_skill_preserves_its_original_location_and_restores() {
    let f = Fixture::new();
    let source = f.path.join("source/demo");
    let original = f.target.join("group/demo");
    write_skill(&source, "demo", "library v1");
    write_skill(&original, "demo", "library v1");
    let imported = skills::import_skill_directory(&f.db, &f.library, &source)
        .unwrap()
        .skill;
    f.scan();
    let row = f.view().skills.remove(0);
    bind_skill(&f.db, &row.instance_ids[0], &imported.id).unwrap();
    write_skill(&source, "demo", "library v2");
    skills::import_skill_directory(&f.db, &f.library, &source).unwrap();
    let v = f.view();
    assert_eq!(v.skills[0].state, "update");
    let plans = preview_updates(&f.db, "claude-code", "user", &[v.skills[0].id.clone()]).unwrap();
    assert_eq!(
        plans[0].items[0].destination_relative.as_deref(),
        Some("group\\demo")
    );
    let operation = safe_apply::apply_sync_plan(
        &f.db,
        &f.path.join("operations"),
        &plans[0].id,
        agent_center::now(),
    )
    .unwrap();
    assert!(fs::read_to_string(original.join("SKILL.md"))
        .unwrap()
        .contains("v2"));
    assert!(!f.target.join("demo").exists());
    safe_apply::restore_operation(&f.db, &operation.id, agent_center::now()).unwrap();
    assert!(fs::read_to_string(original.join("SKILL.md"))
        .unwrap()
        .contains("v1"));
}

#[test]
fn import_completes_optional_metadata_in_copy_and_preserves_original_and_identity() {
    let f = Fixture::new();
    let source = f.path.join("external/demo");
    fs::create_dir_all(&source).unwrap();
    let original = "---\ndescription: 原始描述\n---\n# Body\n";
    fs::write(source.join("SKILL.md"), original).unwrap();
    let p = prepare_import(&f.db, Some(source.to_str().unwrap()), None).unwrap();
    assert_eq!(p.name, "demo");
    let result = import_prepared(&f.db, &f.library, &p.id, "demo", "补充后的描述").unwrap();
    assert_eq!(
        fs::read_to_string(source.join("SKILL.md")).unwrap(),
        original
    );
    assert!(
        fs::read_to_string(Path::new(&result.skill.library_path).join("SKILL.md"))
            .unwrap()
            .contains("name: demo")
    );
    let p2 = prepare_import(&f.db, Some(source.to_str().unwrap()), None).unwrap();
    assert_eq!(
        result.skill.id,
        import_prepared(&f.db, &f.library, &p2.id, "demo", "补充后的描述")
            .unwrap()
            .skill
            .id
    );
}

#[test]
fn changing_source_after_import_preview_blocks_write() {
    let f = Fixture::new();
    let source = f.path.join("external/demo");
    write_skill(&source, "demo", "v1");
    let p = prepare_import(&f.db, Some(source.to_str().unwrap()), None).unwrap();
    write_skill(&source, "demo", "v2");
    assert!(import_prepared(&f.db, &f.library, &p.id, "demo", "description").is_err());
    assert!(f.db.list_skills().unwrap().is_empty());
}

#[test]
fn readonly_sources_never_offer_an_update() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "library");
    write_skill(&f.target.join("demo"), "demo", "external");
    f.scan();
    let row = f.view().skills.remove(0);
    bind_skill(&f.db, &row.instance_ids[0], &record.id).unwrap();
    agent_center::register_root(&f.db, "claude-code", &f.target, "user", "system", None).unwrap();
    let v = f.view();
    assert!(v.skills[0].readonly);
    assert!(!v.skills[0].can_update);
}

#[test]
fn destination_rejects_parent_escape_and_absolute_path() {
    let f = Fixture::new();
    assert!(safe_apply::selection_destination(&f.target, "../outside").is_err());
    assert!(safe_apply::selection_destination(&f.target, f.path.to_str().unwrap()).is_err());
}

#[test]
fn missing_backup_disables_recovery_without_changing_installed_files() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "new");
    write_skill(&f.target.join("demo"), "demo", "original");
    let plan =
        crate::bundle_planner::generate_selection_plan(&f.db, &[record.id], &f.root).unwrap();
    let operation =
        safe_apply::apply_sync_plan(&f.db, &f.path.join("operations"), &plan.id, 1).unwrap();
    let backup = Path::new(operation.items[0].snapshot_path.as_ref().unwrap());
    assert!(dunce::simplified(backup).starts_with(dunce::simplified(&f.target)));
    fs::remove_dir_all(backup).unwrap();
    let before = safe_apply::target_fingerprint(&f.target.join("demo")).unwrap();
    let history = safe_apply::list_apply_operations(&f.db).unwrap();
    assert!(!history[0].can_restore);
    assert_eq!(history[0].backup_state, "missing");
    assert!(safe_apply::restore_operation(&f.db, &operation.id, 2).is_err());
    assert_eq!(
        before,
        safe_apply::target_fingerprint(&f.target.join("demo")).unwrap()
    );
}

#[test]
fn batch_update_tracks_multiple_copies_of_one_library_skill_and_restores_all() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "v1");
    for folder in ["a/demo", "b/demo"] {
        write_skill(&f.target.join(folder), "demo", "v1");
    }
    f.scan();
    for row in f.view().skills {
        bind_skill(&f.db, &row.instance_ids[0], &record.id).unwrap();
    }
    f.import("source", "demo", "v2");
    let ids = f
        .view()
        .skills
        .iter()
        .map(|s| s.id.clone())
        .collect::<Vec<_>>();
    let plans = preview_updates(&f.db, "claude-code", "user", &ids).unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].items.len(), 2);
    assert_ne!(plans[0].items[0].id, plans[0].items[1].id);
    let operation = safe_apply::apply_sync_plan(
        &f.db,
        &f.path.join("operations"),
        &plans[0].id,
        agent_center::now(),
    )
    .unwrap();
    assert_eq!(safe_apply::list_deployments(&f.db).unwrap().len(), 2);
    assert!(operation.can_restore);
    assert!(safe_apply::apply_sync_plan(
        &f.db,
        &f.path.join("operations"),
        &plans[0].id,
        agent_center::now()
    )
    .is_err());
    f.import("source", "demo", "v3");
    assert!(f
        .view()
        .skills
        .iter()
        .all(|s| s.state == "update" && !s.local_modified));
    safe_apply::restore_operation(&f.db, &operation.id, agent_center::now()).unwrap();
    for folder in ["a/demo", "b/demo"] {
        assert!(fs::read_to_string(f.target.join(folder).join("SKILL.md"))
            .unwrap()
            .contains("v1"));
    }
    assert!(safe_apply::list_deployments(&f.db).unwrap().is_empty());
}

#[test]
fn later_copy_failure_rolls_back_the_entire_directory_batch() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "v1");
    for folder in ["a/demo", "b/demo"] {
        write_skill(&f.target.join(folder), "demo", "v1");
    }
    f.scan();
    for row in f.view().skills {
        bind_skill(&f.db, &row.instance_ids[0], &record.id).unwrap();
    }
    f.import("source", "demo", "v2");
    let plan = preview_updates(
        &f.db,
        "claude-code",
        "user",
        &f.view()
            .skills
            .iter()
            .map(|s| s.id.clone())
            .collect::<Vec<_>>(),
    )
    .unwrap()
    .remove(0);
    f.db.connect().unwrap().execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON apply_operation_items WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'injected second item failure'); END;").unwrap();
    assert!(safe_apply::apply_sync_plan(
        &f.db,
        &f.path.join("operations"),
        &plan.id,
        agent_center::now()
    )
    .is_err());
    for folder in ["a/demo", "b/demo"] {
        assert!(fs::read_to_string(f.target.join(folder).join("SKILL.md"))
            .unwrap()
            .contains("v1"));
    }
    assert!(safe_apply::list_deployments(&f.db).unwrap().is_empty());
    assert_eq!(
        safe_apply::list_apply_operations(&f.db).unwrap()[0].status,
        "rolled_back"
    );
}

#[test]
fn restore_refuses_changed_target_without_touching_other_copies() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "v2");
    for folder in ["a/demo", "b/demo"] {
        write_skill(&f.target.join(folder), "demo", "v1");
    }
    f.scan();
    for row in f.view().skills {
        bind_skill(&f.db, &row.instance_ids[0], &record.id).unwrap();
    }
    let plan = preview_updates(
        &f.db,
        "claude-code",
        "user",
        &f.view()
            .skills
            .iter()
            .map(|s| s.id.clone())
            .collect::<Vec<_>>(),
    )
    .unwrap()
    .remove(0);
    let operation = safe_apply::apply_sync_plan(
        &f.db,
        &f.path.join("operations"),
        &plan.id,
        agent_center::now(),
    )
    .unwrap();
    write_skill(&f.target.join("b/demo"), "demo", "manual edit");
    let before = safe_apply::target_fingerprint(&f.target).unwrap();
    assert!(safe_apply::restore_operation(&f.db, &operation.id, agent_center::now()).is_err());
    assert_eq!(before, safe_apply::target_fingerprint(&f.target).unwrap());
}

#[test]
fn migration_preserves_old_history_backups_and_deployment_identity() {
    let f = Fixture::new();
    let record = f.import("source", "demo", "v1");
    let plan = crate::bundle_planner::generate_selection_plan(
        &f.db,
        std::slice::from_ref(&record.id),
        &f.root,
    )
    .unwrap();
    safe_apply::apply_sync_plan(&f.db, &f.path.join("operations"), &plan.id, 1).unwrap();
    f.db.connect()
        .unwrap()
        .execute("UPDATE deployments SET id='legacy-deployment-id'", [])
        .unwrap();
    f.import("source", "demo", "v2");
    let plan = crate::bundle_planner::generate_selection_plan(
        &f.db,
        std::slice::from_ref(&record.id),
        &f.root,
    )
    .unwrap();
    let operation =
        safe_apply::apply_sync_plan(&f.db, &f.path.join("operations"), &plan.id, 2).unwrap();
    f.db.connect().unwrap().execute_batch("PRAGMA foreign_keys=OFF; BEGIN;
      CREATE UNIQUE INDEX legacy_pair ON deployments(skill_id,root_id);
      CREATE UNIQUE INDEX legacy_item_pair ON apply_operation_items(operation_id,skill_id);
      CREATE TABLE legacy_previous(operation_id TEXT NOT NULL,skill_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(operation_id,skill_id));
      INSERT INTO legacy_previous SELECT operation_id,skill_id,payload_json FROM apply_previous_records;
      DROP TABLE apply_previous_records; ALTER TABLE legacy_previous RENAME TO apply_previous_records;
      DELETE FROM schema_meta WHERE key='deployment_location_version'; COMMIT;").unwrap();
    let migrated = Database::initialize(f.db.path()).unwrap();
    assert_eq!(
        safe_apply::list_apply_operations(&migrated).unwrap().len(),
        2
    );
    let violations: i64 = migrated
        .connect()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(violations, 0);
    safe_apply::restore_operation(&migrated, &operation.id, 3).unwrap();
    assert_eq!(
        safe_apply::list_deployments(&migrated).unwrap()[0].id,
        "legacy-deployment-id"
    );
    assert!(fs::read_to_string(f.target.join("demo/SKILL.md"))
        .unwrap()
        .contains("v1"));
}
