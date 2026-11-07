//! Opaque, versioned backend backup. Assets are SQLite BLOBs, never archive paths.
#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> Scratch {
        // Keep the fixture outside symlinked ancestors such as macOS /var.
                Scratch::new(&fs::canonicalize(std::env::temp_dir()).unwrap()).unwrap()
    }
    #[test]
    fn roundtrip_all_ledgers_assets_and_registry() {
        let root = temp();
        let storage = Storage::new(root.0.join("live")).unwrap();
        let original = storage.settings().unwrap();
        let first = original["ledger"]["id"].as_str().unwrap().to_owned();
        let c = storage.connection().unwrap();
        c.execute_batch("INSERT INTO accounts(id,name,opening) VALUES ('a','First',1234); INSERT INTO transactions(id,kind,date,description,amount,account_id,category) VALUES ('t','expense','2026-01-01','Test',100,'a','Other'); INSERT INTO receipts VALUES ('r','t','receipt.pdf','application/pdf',5); INSERT INTO receipt_files VALUES ('r',x'255044462D'); INSERT INTO ledger_cover VALUES (1,'v','image/png',x'010203',23);").unwrap();
        drop(c);
        storage.create_ledger(&json!({"name":"Second","currency":"EUR"})).unwrap();
        storage
            .connection()
            .unwrap()
            .execute("INSERT INTO goals VALUES ('g','Goal',10000,'2027-01-01')", [])
            .unwrap();
        storage.update_profile(&json!({"username":"Restored","language":"zh-SG"})).unwrap();
        let expected = storage.settings().unwrap();
        let payload = storage.export_backup().unwrap();
        storage.update_profile(&json!({"username":"Changed","language":"en-SG"})).unwrap();
        storage.create_ledger(&json!({"name":"Unwanted"})).unwrap();
        storage.restore_backup(payload, "RESTORE").unwrap();
        assert_eq!(storage.settings().unwrap(), expected);
        assert_eq!(
            storage
                .connection()
                .unwrap()
                .query_row("SELECT name FROM goals", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Goal"
        );
        storage.switch_ledger(&json!({"id":first})).unwrap();
        let c = storage.connection().unwrap();
        assert_eq!(
            c.query_row("SELECT bytes FROM receipt_files", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(),
            b"%PDF-"
        );
        assert_eq!(
            c.query_row("SELECT image FROM ledger_cover", [], |r| r.get::<_, Vec<u8>>(0)).unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            c.query_row("SELECT opening FROM accounts", [], |r| r.get::<_, i64>(0)).unwrap(),
            1234
        );
    }
    #[test]
    fn rejects_tamper_paths_missing_confirmation_and_preserves_live() {
        let root = temp();
        let storage = Storage::new(root.0.join("live")).unwrap();
        let before = storage.settings().unwrap();
        let payload = storage.export_backup().unwrap();
        assert!(storage.restore_backup(payload.clone(), "no").is_err());
        for kind in 0..5 {
            let mut bad = payload.clone();
            match kind {
                0 => bad["ledgers"][0]["id"] = json!("../../outside"),
                1 => bad["version"] = json!(999),
                2 => bad["ledgers"] = json!([]),
                3 => bad["registry"] = json!([1, 2, 3]),
                _ => {
                    let path = root.0.join("tamper.sqlite");
                    let bytes: Vec<u8> =
                        serde_json::from_value(bad["ledgers"][0]["database"].clone()).unwrap();
                    fs::write(&path, bytes).unwrap();
                    let c = Connection::open(&path).unwrap();
                    c.execute_batch("CREATE TRIGGER evil AFTER INSERT ON accounts BEGIN DELETE FROM goals; END;").unwrap();
                    drop(c);
                    bad["ledgers"][0]["database"] = json!(fs::read(path).unwrap());
                }
            }
            assert!(storage.restore_backup(bad, "RESTORE").is_err());
            assert_eq!(storage.settings().unwrap(), before);
        }
        storage
            .update_profile(&json!({"username":"Keep this mutation","language":"en-SG"}))
            .unwrap();
        let mutated = storage.settings().unwrap();
        assert!(
            storage
                .restore_with_check(payload.clone(), "RESTORE", || Err(
                    "Injected post-swap failure".into()
                ))
                .is_err()
        );
        assert_eq!(storage.settings().unwrap(), mutated);
        storage.restore_backup(payload.clone(), "RESTORE").unwrap();
        assert_eq!(storage.settings().unwrap(), before);
        // A filesystem failure before replacement must leave the live data untouched.
        fs::create_dir(storage.directory.join("backups")).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/nonexistent", storage.directory.join("backups/link"))
                .unwrap();
            assert!(storage.restore_backup(payload, "RESTORE").is_err());
            assert_eq!(storage.settings().unwrap(), before);
        }
    }
}
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::io::Write;

pub const MAX_SERIALIZED: usize = 128 * 1024 * 1024;
const MAX_DATABASE: usize = 32 * 1024 * 1024;
const MAX_LEDGERS: usize = 256;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u32,
    registry: Vec<u8>,
    ledgers: Vec<Ledger>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    id: String,
    database: Vec<u8>,
}
struct Scratch(PathBuf);
impl Scratch {
    fn new(parent: &Path) -> R<Self> {
        let path = parent.join(format!(".folio-stage-{}", Uuid::new_v4()));
        fs::create_dir(&path).map_err(err)?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
// Count serialized bytes without allocating another potentially enormous JSON buffer.
struct Counter(usize);
impl Write for Counter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0 += bytes.len();
        if self.0 > MAX_SERIALIZED {
            return Err(std::io::Error::other("Backup exceeds 128 MiB serialized JSON limit."));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn bounded(value: &impl Serialize) -> R<()> {
    serde_json::to_writer(Counter(0), value).map_err(err)
}
type SchemaObject = (String, String, String, Option<String>);
fn schema(c: &Connection) -> R<Vec<SchemaObject>> {
    c.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)
}
fn readonly(path: &Path) -> R<Connection> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    c.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;").map_err(err)?;
    Ok(c)
}
fn checked(path: &Path, trusted: &Connection, ledger: bool) -> R<Connection> {
    let c = readonly(path)?;
    // Compare *all* objects, including autoindexes, views and triggers before querying data.
    if schema(&c)? != schema(trusted)? {
        return Err("Unsupported or altered SQLite schema.".into());
    }
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
    if version != 0 {
        return Err("Unsupported SQLite schema version.".into());
    }
    validate(&c)?;
    if ledger {
        let rows = |db: &Connection| -> R<Vec<(String, String)>> {
            db.prepare("SELECT name,checksum FROM _migrations ORDER BY name")
                .map_err(err)?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)
        };
        if rows(&c)? != rows(trusted)? {
            return Err("Unsupported migration history.".into());
        }
        let missing: i64 = c.query_row("SELECT count(*) FROM receipts r LEFT JOIN receipt_files f ON f.id=r.id WHERE f.id IS NULL OR length(f.bytes)<>r.size OR r.size>5242880 OR r.size<1", [], |r| r.get(0)).map_err(err)?;
        if missing != 0 {
            return Err("Missing or invalid receipt bytes.".into());
        }
    }
    Ok(c)
}
fn ledger_ids(c: &Connection) -> R<Vec<String>> {
    let ids = c
        .prepare("SELECT id FROM ledgers ORDER BY rowid")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    if ids.is_empty() || ids.len() > MAX_LEDGERS {
        return Err("Backup must contain 1–256 ledgers.".into());
    }
    for value in &ids {
        id(value)?;
    }
    let profile: Vec<String> = c
        .prepare("SELECT id FROM profile")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    if profile.len() != 1 {
        return Err("Backup must contain exactly one profile.".into());
    }
    id(&profile[0])?;
    let selected: String = c
        .query_row("SELECT value FROM app_settings WHERE key='selected_ledger'", [], |r| r.get(0))
        .map_err(err)?;
    if !ids.contains(&selected) {
        return Err("Selected ledger is missing.".into());
    }
    let mut st = c.prepare("SELECT currency FROM ledgers").map_err(err)?;
    for unit in st.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
        currency(&unit.map_err(err)?)?;
    }
    Ok(ids)
}
fn write_database(path: &Path, bytes: &[u8]) -> R<()> {
    if bytes.len() > MAX_DATABASE || !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Invalid SQLite snapshot or database exceeds 32 MiB.".into());
    }
    fs::write(path, bytes).map_err(err)
}
impl Storage {
    pub fn export_backup(&self) -> R<Value> {
        reject_links(&self.directory)?;
        let scratch = Scratch::new(&self.directory)?;
        let registry = self.registry()?;
        let ids = ledger_ids(&registry)?;
        let path = scratch.0.join("registry.sqlite");
        backup(&self.directory.join("folio.sqlite"), &path)?;
        let registry = fs::read(path).map_err(err)?;
        if registry.len() > MAX_DATABASE {
            return Err("Registry exceeds 32 MiB.".into());
        }
        let mut manifest =
            Manifest { format: "folio-full-backup".into(), version: 1, registry, ledgers: vec![] };
        for id in ids {
            let path = scratch.0.join(format!("{id}.sqlite"));
            backup(&self.ledger_path(&id)?, &path)?;
            if fs::metadata(&path).map_err(err)?.len() > MAX_DATABASE as u64 {
                return Err("Ledger exceeds 32 MiB.".into());
            }
            manifest.ledgers.push(Ledger { id, database: fs::read(path).map_err(err)? });
            bounded(&manifest)?;
        }
        bounded(&manifest)?;
        serde_json::to_value(manifest).map_err(err)
    }
    pub fn restore_backup(&self, value: Value, confirmation: &str) -> R<Value> {
        self.restore_with_check(value, confirmation, || self.settings().map(|_| ()))
    }
    fn restore_with_check(
        &self,
        value: Value,
        confirmation: &str,
        check: impl FnOnce() -> R<()>,
    ) -> R<Value> {
        if confirmation != "RESTORE" {
            return Err("Type RESTORE to replace all Folio data.".into());
        }
        bounded(&value)?;
        let manifest: Manifest = serde_json::from_value(value).map_err(err)?;
        if manifest.format != "folio-full-backup" || manifest.version != 1 {
            return Err("Unsupported backup format/version.".into());
        }
        if manifest.ledgers.is_empty() || manifest.ledgers.len() > MAX_LEDGERS {
            return Err("Invalid ledger count.".into());
        }
        reject_links(&self.directory)?;
        let stage = Scratch::new(&self.directory)?;
        let trusted_dir = stage.0.join("trusted");
        let trusted = Storage::new(trusted_dir)?;
        let trusted_registry = trusted.registry()?;
        let trusted_ledger = trusted.connection()?;
        let target = stage.0.join("incoming");
        fs::create_dir(&target).map_err(err)?;
        fs::create_dir(target.join("ledgers")).map_err(err)?;
        let registry_path = target.join("folio.sqlite");
        write_database(&registry_path, &manifest.registry)?;
        let registry = checked(&registry_path, &trusted_registry, false)?;
        let ids = ledger_ids(&registry)?.into_iter().collect::<BTreeSet<_>>();
        drop(registry);
        let mut seen = BTreeSet::new();
        for ledger in manifest.ledgers {
            id(&ledger.id)?;
            if !ids.contains(&ledger.id) || !seen.insert(ledger.id.clone()) {
                return Err("Duplicate or unregistered ledger.".into());
            }
            let path = target.join("ledgers").join(format!("{}.sqlite", ledger.id));
            write_database(&path, &ledger.database)?;
            checked(&path, &trusted_ledger, true)?;
        }
        if ids != seen {
            return Err("Missing ledger snapshot.".into());
        }
        // Recovery snapshots must succeed before the first rename. No imported paths are used.
        let recovery = self.directory.join(format!("recovery-{}", Uuid::new_v4()));
        fs::create_dir(&recovery).map_err(err)?;
        let recovery_value = self.export_backup()?;
        let recovery_file = recovery.join("backup.json");
        let mut file = fs::File::create(&recovery_file).map_err(err)?;
        serde_json::to_writer(&mut file, &recovery_value).map_err(err)?;
        file.sync_all().map_err(err)?;
        let old = recovery.join("originals");
        fs::create_dir(&old).map_err(err)?;
        let names = ["folio.sqlite", "folio.sqlite-wal", "folio.sqlite-shm", "ledgers"];
        let mut moved = Vec::new();
        let mut installed = Vec::new();
        let result = (|| -> R<()> {
            for name in names {
                let source = self.directory.join(name);
                if source.exists() {
                    fs::rename(source, old.join(name)).map_err(err)?;
                    moved.push(name);
                }
            }
            for name in ["folio.sqlite", "ledgers"] {
                fs::rename(target.join(name), self.directory.join(name)).map_err(err)?;
                installed.push(name);
            }
            check()?;
            Ok(())
        })();
        if let Err(e) = result {
            for name in installed.into_iter().rev() {
                fs::rename(self.directory.join(name), target.join(name)).map_err(|r| {
                    format!("{e}; rollback failed: {r}. Recovery: {}", recovery.display())
                })?;
            }
            // settings() may create WAL sidecars; remove them before restoring the originals.
            for name in ["folio.sqlite-wal", "folio.sqlite-shm"] {
                let _ = fs::remove_file(self.directory.join(name));
            }
            for name in moved.into_iter().rev() {
                fs::rename(old.join(name), self.directory.join(name)).map_err(|r| {
                    format!("{e}; rollback failed: {r}. Recovery: {}", recovery.display())
                })?;
            }
            return Err(e);
        }
        Ok(
            json!({"message":"All Folio backend data restored.","warning":format!("Previous data retained at {}. Frontend localStorage is managed separately.", recovery.display())}),
        )
    }
}
