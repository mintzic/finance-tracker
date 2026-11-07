use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

type R<T> = Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
const REGISTRY: &str = "CREATE TABLE IF NOT EXISTS local_profiles (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, language TEXT NOT NULL DEFAULT 'en-SG', currency TEXT NOT NULL DEFAULT 'SGD', legacy INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS native_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);";
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_initial.sql",
        include_str!("../migrations/0001_initial.sql"),
    ),
    (
        "0002_login_attempts.sql",
        include_str!("../migrations/0002_login_attempts.sql"),
    ),
    (
        "0003_shared_workspace.sql",
        include_str!("../migrations/0003_shared_workspace.sql"),
    ),
    (
        "0004_subscription_charges.sql",
        include_str!("../migrations/0004_subscription_charges.sql"),
    ),
    (
        "0005_categories.sql",
        include_str!("../migrations/0005_categories.sql"),
    ),
    (
        "0006_workspace_cover.sql",
        include_str!("../migrations/0006_workspace_cover.sql"),
    ),
    (
        "0007_recurring_budgets.sql",
        include_str!("../migrations/0007_recurring_budgets.sql"),
    ),
    (
        "0008_subscription_categories.sql",
        include_str!("../migrations/0008_subscription_categories.sql"),
    ),
];
fn configure(c: &Connection) -> R<()> {
    c.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(err)
}
fn backup(source: &Path, target: &Path) -> R<()> {
    let c = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    c.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    c.backup("main", target, None::<fn(rusqlite::backup::Progress)>)
        .map_err(err)
}
fn migrate(path: &Path) -> R<Connection> {
    let mut c = Connection::open(path).map_err(err)?;
    configure(&c)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
    )
    .map_err(err)?;
    for &(name, sql) in MIGRATIONS {
        let checksum = format!("{:x}", Sha256::digest(sql.as_bytes()));
        let previous: Option<String> = c
            .query_row(
                "SELECT checksum FROM _migrations WHERE name=?",
                [name],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(previous) = previous {
            if previous != checksum {
                return Err(format!("Applied migration changed: {name}"));
            }
            continue;
        }
        if name == "0003_shared_workspace.sql" {
            backup(
                path,
                &path.with_extension(format!(
                    "sqlite.before-shared-workspace-{}.bak",
                    Uuid::new_v4()
                )),
            )?;
        }
        let tx = c.transaction().map_err(err)?;
        tx.execute_batch(sql).map_err(err)?;
        validate(&tx)?;
        tx.execute(
            "INSERT INTO _migrations VALUES (?,?)",
            params![name, checksum],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
    }
    crate::commands::shared::initialize(&c)?;
    Ok(c)
}
fn validate(c: &Connection) -> R<()> {
    let check: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    if check != "ok" {
        return Err(format!("SQLite integrity check failed: {check}"));
    }
    if c.prepare("PRAGMA foreign_key_check")
        .map_err(err)?
        .query([])
        .map_err(err)?
        .next()
        .map_err(err)?
        .is_some()
    {
        return Err("Foreign key check failed.".into());
    }
    Ok(())
}
fn id(value: &str) -> R<()> {
    if Uuid::parse_str(value)
        .map(|u| u.to_string() == value)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("Invalid profile or receipt ID.".into())
    }
}
fn field<'a>(f: &'a Value, k: &str) -> &'a str {
    f.get(k).and_then(Value::as_str).unwrap_or("")
}
fn selected(c: &Connection) -> R<Option<String>> {
    c.query_row(
        "SELECT value FROM native_settings WHERE key='selected_profile'",
        [],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
fn list(c: &Connection) -> R<Vec<Value>> {
    c.prepare("SELECT id,username,language,currency,legacy FROM local_profiles ORDER BY username").map_err(err)?
        .query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"username":r.get::<_,String>(1)?,"language":r.get::<_,String>(2)?,"currency":r.get::<_,String>(3)?,"legacy":r.get::<_,i64>(4)?}))).map_err(err)?
        .collect::<Result<Vec<_>,_>>().map_err(err)
}
fn preferences(language: &str, currency: &str) -> R<()> {
    if !["en-SG", "zh-SG", "ms-MY"].contains(&language)
        || !["SGD", "USD", "EUR", "GBP", "MYR", "CNY", "AUD", "THB"].contains(&currency)
    {
        return Err("Choose a supported language and currency.".into());
    }
    Ok(())
}

pub struct Workspace {
    pub directory: PathBuf,
}
impl Workspace {
    pub fn new(directory: PathBuf) -> R<Self> {
        fs::create_dir_all(directory.join("profiles")).map_err(err)?;
        let c = migrate(&directory.join("finance.sqlite"))?;
        c.execute_batch(REGISTRY).map_err(err)?;
        Ok(Self { directory })
    }
    fn registry(&self) -> R<Connection> {
        let c = Connection::open(self.directory.join("finance.sqlite")).map_err(err)?;
        configure(&c)?;
        Ok(c)
    }
    pub fn profiles(&self) -> R<Value> {
        let c = self.registry()?;
        let profiles = list(&c)?;
        let active = selected(&c)?;
        let profile = profiles
            .iter()
            .find(|p| p["id"].as_str() == active.as_deref())
            .cloned()
            .unwrap_or(Value::Null);
        Ok(json!({"profile":profile,"profiles":profiles}))
    }
    pub fn connection(&self) -> R<Connection> {
        let c = self.registry()?;
        let active = selected(&c)?.ok_or("Select a profile first.")?;
        id(&active)?;
        let legacy: i64 = c
            .query_row(
                "SELECT legacy FROM local_profiles WHERE id=?",
                [&active],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .ok_or("Select a profile first.")?;
        if legacy == 1 {
            Ok(c)
        } else {
            migrate(
                &self
                    .directory
                    .join("profiles")
                    .join(format!("{active}.sqlite")),
            )
        }
    }
    pub fn create_profile(&self, form: &Value) -> R<Value> {
        self.save_profile(form, true)
    }
    pub fn update_profile(&self, form: &Value) -> R<Value> {
        self.save_profile(form, false)
    }
    fn save_profile(&self, form: &Value, creating: bool) -> R<Value> {
        let mut c = self.registry()?;
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let username = field(form, "username").trim();
        if username.is_empty()
            || username.encode_utf16().count() > 80
            || username.chars().any(char::is_control)
        {
            return Err("Enter a username of 1–80 characters.".into());
        }
        let active = if creating {
            Uuid::new_v4().to_string()
        } else {
            selected(&tx)?.ok_or("Select a profile first.")?
        };
        let profiles = list(&tx)?;
        if profiles.iter().any(|p| {
            p["id"] != active && field(p, "username").to_lowercase() == username.to_lowercase()
        }) {
            return Err("That username already exists.".into());
        }
        if creating {
            let language = form
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or("en-SG");
            let currency = form
                .get("currency")
                .and_then(Value::as_str)
                .unwrap_or("SGD");
            preferences(language, currency)?;
            if !profiles.is_empty() {
                migrate(
                    &self
                        .directory
                        .join("profiles")
                        .join(format!("{active}.sqlite")),
                )?;
            }
            tx.execute("INSERT INTO local_profiles(id,username,language,currency,legacy) VALUES (?,?,?,?,?)", params![active,username,language,currency,i64::from(profiles.is_empty())]).map_err(err)?;
        } else {
            preferences(field(form, "language"), field(form, "currency"))?;
            if tx
                .execute(
                    "UPDATE local_profiles SET username=?,language=?,currency=? WHERE id=?",
                    params![
                        username,
                        field(form, "language"),
                        field(form, "currency"),
                        active
                    ],
                )
                .map_err(err)?
                != 1
            {
                return Err("Select a profile first.".into());
            }
        }
        tx.execute("INSERT INTO native_settings(key,value) VALUES ('selected_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [&active]).map_err(err)?;
        tx.commit().map_err(err)?;
        let mut result = self.profiles()?;
        result["message"] = json!(if creating {
            "Workspace opened."
        } else {
            "Settings saved."
        });
        Ok(result)
    }
    pub fn switch_profile(&self, form: &Value) -> R<Value> {
        let mut c = self.registry()?;
        let tx = c
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let active = field(form, "profile_id");
        id(active)?;
        if !list(&tx)?.iter().any(|p| p["id"] == active) {
            return Err("Choose a profile.".into());
        }
        tx.execute("INSERT INTO native_settings(key,value) VALUES ('selected_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [active]).map_err(err)?;
        tx.commit().map_err(err)?;
        let mut result = self.profiles()?;
        result["message"] = json!("Workspace opened.");
        Ok(result)
    }
    #[cfg(test)]
    fn profile_action(&self, form: &Value) -> R<Value> {
        match field(form, "intent") {
            "create_profile" => self.create_profile(form),
            "save_profile" => self.update_profile(form),
            "switch_profile" => self.switch_profile(form),
            _ => Err("Unknown profile action.".into()),
        }
    }

    /// Explicit import only. Backups and conversion occur outside the target until publication.
    pub fn import_legacy(&self, source: &str) -> R<Value> {
        let source = Path::new(source);
        reject_links(source)?;
        let source = source.canonicalize().map_err(err)?;
        reject_links(&self.directory)?;
        let target = self.directory.canonicalize().map_err(err)?;
        if source == target || source.starts_with(&target) || target.starts_with(&source) {
            return Err("Source and target must be separate directories.".into());
        }
        self.empty_target()?;
        let parent = target.parent().ok_or("Target has no parent.")?;
        let stage = parent.join(format!(".folio-import-{}", Uuid::new_v4()));
        fs::create_dir(&stage).map_err(err)?;
        let result = (|| {
            let backups = stage.join("legacy-backup");
            fs::create_dir(&backups).map_err(err)?;
            // Snapshot every database before running any migrations or conversion.
            backup(
                &source.join("finance.sqlite"),
                &backups.join("finance.sqlite"),
            )?;
            let registry = Connection::open(backups.join("finance.sqlite")).map_err(err)?;
            registry.execute_batch(REGISTRY).map_err(err)?;
            let profiles = list(&registry)?;
            for p in &profiles {
                id(field(p, "id"))?;
                preferences(field(p, "language"), field(p, "currency"))?;
                if p["legacy"] != 0 && p["legacy"] != 1 {
                    return Err("Invalid legacy profile flag.".into());
                }
                if p["legacy"] == 0 {
                    fs::create_dir_all(backups.join("profiles")).map_err(err)?;
                    let name = format!("{}.sqlite", field(p, "id"));
                    backup(
                        &source.join("profiles").join(&name),
                        &backups.join("profiles").join(name),
                    )?;
                }
            }
            drop(registry);
            fs::create_dir(stage.join("profiles")).map_err(err)?;
            backup(
                &backups.join("finance.sqlite"),
                &stage.join("finance.sqlite"),
            )?;
            for p in &profiles {
                if p["legacy"] == 0 {
                    let name = format!("{}.sqlite", field(p, "id"));
                    backup(
                        &backups.join("profiles").join(&name),
                        &stage.join("profiles").join(name),
                    )?;
                }
            }
            // Preserve original receipt files alongside the unmodified database snapshots.
            if source.join("receipts").exists() {
                copy_tree(&source.join("receipts"), &backups.join("receipts"))?;
            }
            let mut paths = vec![stage.join("finance.sqlite")];
            paths.extend(profiles.iter().filter(|p| p["legacy"] == 0).map(|p| {
                stage
                    .join("profiles")
                    .join(format!("{}.sqlite", field(p, "id")))
            }));
            for path in paths {
                let mut c = migrate(&path)?;
                let receipts = c
                    .prepare("SELECT id,size FROM receipts")
                    .map_err(err)?
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
                    .map_err(err)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(err)?;
                let tx = c.transaction().map_err(err)?;
                for (receipt, size) in receipts {
                    id(&receipt)?;
                    let bytes = fs::read(backups.join("receipts").join(&receipt)).map_err(err)?;
                    if bytes.len() as i64 != size {
                        return Err(format!("Receipt size mismatch: {receipt}"));
                    }
                    tx.execute(
                        "INSERT OR REPLACE INTO native_files(id,bytes) VALUES (?,?)",
                        params![receipt, bytes],
                    )
                    .map_err(err)?;
                }
                tx.commit().map_err(err)?;
                validate(&c)?;
                c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                    .map_err(err)?;
            }
            let c = Connection::open(stage.join("finance.sqlite")).map_err(err)?;
            c.execute_batch(REGISTRY).map_err(err)?;
            c.execute("DELETE FROM native_settings", []).map_err(err)?;
            c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .map_err(err)?;
            drop(c);
            self.empty_target()?;
            let old = parent.join(format!(".folio-empty-{}", Uuid::new_v4()));
            fs::rename(&target, &old).map_err(err)?;
            if let Err(e) = fs::rename(&stage, &target) {
                fs::rename(&old, &target).map_err(|restore| {
                    format!(
                        "Publish failed: {e}; restore failed: {restore}; original target: {}",
                        old.display()
                    )
                })?;
                return Err(err(e));
            }
            let _ = fs::remove_dir_all(old);
            self.profiles()
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&stage);
        }
        result
    }
    fn empty_target(&self) -> R<()> {
        if !list(&self.registry()?)?.is_empty() {
            return Err("Import requires an empty target workspace.".into());
        }
        let c = self.registry()?;
        for entry in fs::read_dir(&self.directory).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let generated_backup = name.starts_with("finance.sqlite.before-shared-workspace-")
                && name.ends_with(".bak");
            if ![
                "finance.sqlite",
                "finance.sqlite-wal",
                "finance.sqlite-shm",
                "profiles",
            ]
            .contains(&name.as_str())
                && !generated_backup
            {
                return Err(
                    "Import requires an empty target directory; unrecognized files are present."
                        .into(),
                );
            }
        }
        for table in [
            "wallets",
            "entries",
            "budgets",
            "subscriptions",
            "goals",
            "contributions",
            "receipts",
            "workspace_cover",
        ] {
            let count: i64 = c
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .map_err(err)?;
            if count != 0 {
                return Err("Import requires an empty target workspace.".into());
            }
        }
        if fs::read_dir(self.directory.join("profiles"))
            .map_err(err)?
            .next()
            .is_some()
        {
            return Err("Import requires an empty profiles directory.".into());
        }
        Ok(())
    }
}
// Reject links throughout the source tree, including its ancestors, before opening SQLite.
fn reject_links(path: &Path) -> R<()> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)
            .map_err(err)?
            .file_type()
            .is_symlink()
        {
            return Err("Symbolic links are not allowed in imports.".into());
        }
    }
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(err)? {
            reject_links(&entry.map_err(err)?.path())?;
        }
    } else if !path.is_file() {
        return Err("Only regular files and directories may be imported.".into());
    }
    Ok(())
}
fn copy_tree(source: &Path, target: &Path) -> R<()> {
    fs::create_dir(target).map_err(err)?;
    for entry in fs::read_dir(source).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_type().map_err(err)?.is_dir() {
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), target.join(entry.file_name())).map_err(err)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("folio-workspace-test-{}", Uuid::new_v4())))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn isolation_and_restart() {
        let dir = Temp::new();
        let w = Workspace::new(dir.0.clone()).unwrap();
        assert!(w.connection().is_err());
        let first = w
            .profile_action(&json!({"intent":"create_profile","username":"First"}))
            .unwrap()["profile"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        w.connection()
            .unwrap()
            .execute(
                "INSERT INTO wallets(id,name,opening) VALUES ('first','First wallet',0)",
                [],
            )
            .unwrap();
        w.profile_action(&json!({"intent":"create_profile","username":"Second"}))
            .unwrap();
        assert_eq!(
            w.connection()
                .unwrap()
                .query_row("SELECT count(*) FROM wallets", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        w.profile_action(&json!({"intent":"switch_profile","profile_id":first}))
            .unwrap();
        let restarted = Workspace::new(dir.0.clone()).unwrap();
        assert_eq!(restarted.profiles().unwrap()["profile"]["id"], first);
        assert_eq!(
            restarted
                .connection()
                .unwrap()
                .query_row("SELECT count(*) FROM wallets", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(
            w.profile_action(&json!({"intent":"create_profile","username":"FIRST"}))
                .is_err()
        );
        assert!(w.profile_action(&json!({"intent":"save_profile","username":"First","language":"xx","currency":"SGD"})).is_err());
    }
    #[test]
    fn legacy_import_and_nonempty_rejection() {
        let source = Temp::new();
        let target = Temp::new();
        let old = Workspace::new(source.0.clone()).unwrap();
        let first = old
            .profile_action(&json!({"intent":"create_profile","username":"Legacy"}))
            .unwrap()["profile"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let receipt = Uuid::new_v4().to_string();
        let c = old.connection().unwrap();
        c.execute_batch("INSERT INTO wallets(id,name,opening) VALUES ('w','Wallet',0); INSERT INTO entries(id,kind,date,description,amount,wallet_id,category) VALUES ('e','expense','2026-01-01','Test',100,'w','Food');").unwrap();
        c.execute("INSERT INTO receipts(id,entry_id,filename,mime,size) VALUES (?,'e','test.pdf','application/pdf',5)",[&receipt]).unwrap();
        drop(c);
        fs::create_dir(source.0.join("receipts")).unwrap();
        fs::write(source.0.join("receipts").join(&receipt), b"%PDF-").unwrap();
        old.profile_action(&json!({"intent":"create_profile","username":"Other"}))
            .unwrap();
        let w = Workspace::new(target.0.clone()).unwrap();
        let imported = w.import_legacy(source.0.to_str().unwrap()).unwrap();
        assert_eq!(imported["profiles"].as_array().unwrap().len(), 2);
        assert!(imported["profile"].is_null());
        w.profile_action(&json!({"intent":"switch_profile","profile_id":first}))
            .unwrap();
        let bytes: Vec<u8> = w
            .connection()
            .unwrap()
            .query_row(
                "SELECT bytes FROM native_files WHERE id=?",
                [&receipt],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bytes, b"%PDF-");
        assert!(target.0.join("legacy-backup/finance.sqlite").exists());
        assert!(w.import_legacy(source.0.to_str().unwrap()).is_err());
        assert_eq!(
            fs::read(source.0.join("receipts").join(receipt)).unwrap(),
            b"%PDF-"
        );
    }
    #[test]
    fn checksum_and_unsafe_sources() {
        let source = Temp::new();
        let target = Temp::new();
        let old = Workspace::new(source.0.clone()).unwrap();
        old.registry()
            .unwrap()
            .execute(
                "UPDATE _migrations SET checksum='changed' WHERE name='0001_initial.sql'",
                [],
            )
            .unwrap();
        let w = Workspace::new(target.0.clone()).unwrap();
        assert!(
            w.import_legacy(source.0.to_str().unwrap())
                .unwrap_err()
                .contains("Applied migration changed")
        );
        assert!(
            w.profiles().unwrap()["profiles"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(id("../../escape").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target.0, source.0.join("link")).unwrap();
            assert!(
                w.import_legacy(source.0.to_str().unwrap())
                    .unwrap_err()
                    .contains("Symbolic links")
            );
        }
    }
    #[test]
    fn profile_operations_ignore_conflicting_intent() {
        let dir = Temp::new();
        let w = Workspace::new(dir.0.clone()).unwrap();
        let first = w
            .create_profile(&json!({"intent":"switch_profile","username":"First"}))
            .unwrap()["profile"]["id"]
            .clone();
        let updated = w.update_profile(&json!({"intent":"create_profile","username":"Renamed","language":"en-SG","currency":"SGD"})).unwrap();
        assert_eq!(updated["profile"]["id"], first);
        assert_eq!(updated["profiles"].as_array().unwrap().len(), 1);
        w.create_profile(&json!({"username":"Second"})).unwrap();
        let switched = w
            .switch_profile(&json!({"intent":"create_profile","profile_id":first}))
            .unwrap();
        assert_eq!(switched["profile"]["id"], first);
        assert_eq!(switched["profile"]["username"], "Renamed");
        assert_eq!(switched["profiles"].as_array().unwrap().len(), 2);
    }
}
