use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

mod full_backup;

type R<T> = Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_initial.sql", include_str!("../migrations/0001_initial.sql")),
    ("0002_login_attempts.sql", include_str!("../migrations/0002_login_attempts.sql")),
    ("0003_shared_workspace.sql", include_str!("../migrations/0003_shared_workspace.sql")),
    ("0004_subscription_charges.sql", include_str!("../migrations/0004_subscription_charges.sql")),
    ("0005_categories.sql", include_str!("../migrations/0005_categories.sql")),
    ("0006_workspace_cover.sql", include_str!("../migrations/0006_workspace_cover.sql")),
    ("0007_recurring_budgets.sql", include_str!("../migrations/0007_recurring_budgets.sql")),
    (
        "0008_subscription_categories.sql",
        include_str!("../migrations/0008_subscription_categories.sql"),
    ),
    ("0009_ledger_names.sql", include_str!("../migrations/0009_ledger_names.sql")),
];
fn configure(c: &Connection) -> R<()> {
    c.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;").map_err(err)
}
fn backup(source: &Path, target: &Path) -> R<()> {
    let c = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    c.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    c.backup("main", target, None::<fn(rusqlite::backup::Progress)>).map_err(err)
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
            .query_row("SELECT checksum FROM _migrations WHERE name=?", [name], |r| r.get(0))
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
        tx.execute("INSERT INTO _migrations VALUES (?,?)", params![name, checksum]).map_err(err)?;
        tx.commit().map_err(err)?;
    }
    // Registry metadata belongs only in folio.sqlite; legacy sources remain untouched.
    c.execute_batch("DROP TABLE IF EXISTS local_profiles; DROP TABLE IF EXISTS native_settings;")
        .map_err(err)?;
    crate::commands::shared::initialize(&c)?;
    Ok(c)
}
fn validate(c: &Connection) -> R<()> {
    let check: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(err)?;
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
    if Uuid::parse_str(value).map(|u| u.to_string() == value).unwrap_or(false) {
        Ok(())
    } else {
        Err("Invalid ledger, profile, or receipt ID.".into())
    }
}
fn field<'a>(f: &'a Value, k: &str) -> &'a str {
    f.get(k).and_then(Value::as_str).unwrap_or("")
}

const REGISTRY: &str = "
CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, username TEXT NOT NULL, language TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS profile_singleton ON profile ((1));
CREATE TRIGGER IF NOT EXISTS profile_prevent_second_insert BEFORE INSERT ON profile
WHEN EXISTS (SELECT 1 FROM profile)
BEGIN SELECT RAISE(ABORT, 'Only one profile is allowed.'); END;
CREATE TRIGGER IF NOT EXISTS profile_prevent_delete BEFORE DELETE ON profile
BEGIN SELECT RAISE(ABORT, 'The profile cannot be deleted.'); END;
CREATE TABLE IF NOT EXISTS ledgers (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";
const CURRENCIES: &str = "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG ZWL";
fn currency(value: &str) -> R<&str> {
    if CURRENCIES.split_whitespace().any(|c| c == value) {
        Ok(value)
    } else {
        Err("Choose a supported ISO currency.".into())
    }
}
fn text<'a>(form: &'a Value, key: &str, max: usize) -> R<&'a str> {
    let value = field(form, key).trim();
    if value.is_empty() || value.encode_utf16().count() > max {
        return Err(format!("Enter {key} (up to {max} characters)."));
    }
    Ok(value)
}
fn locale_region(locale: &str) -> Option<String> {
    let locale = locale.split(['.', '@']).next().unwrap_or("").replace('-', "_");
    locale
        .split('_')
        .skip(1)
        .find(|s| {
            (s.len() == 2 && s.bytes().all(|b| b.is_ascii_alphabetic()))
                || (s.len() == 3 && s.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(str::to_ascii_uppercase)
}
fn region_currency(locale: &str) -> &'static str {
    match locale_region(locale).as_deref().unwrap_or("") {
        "AT" | "BE" | "CY" | "DE" | "EE" | "ES" | "FI" | "FR" | "GR" | "HR" | "IE" | "IT"
        | "LT" | "LU" | "LV" | "MT" | "NL" | "PT" | "SI" | "SK" | "AD" | "MC" | "SM" | "VA"
        | "ME" | "XK" | "BG" => "EUR",
        "US" | "EC" | "SV" | "PA" | "TL" | "FM" | "MH" | "PW" | "TC" | "VG" | "VI" | "GU"
        | "AS" | "MP" | "PR" => "USD",
        "GB" | "GG" | "JE" | "IM" => "GBP",
        "AU" | "CX" | "CC" | "KI" | "NR" | "TV" => "AUD",
        "NZ" | "CK" | "NU" | "TK" | "PN" => "NZD",
        "CH" | "LI" => "CHF",
        "DK" | "FO" | "GL" => "DKK",
        "NO" | "SJ" | "BV" => "NOK",
        "BJ" | "BF" | "CI" | "GW" | "ML" | "NE" | "SN" | "TG" => "XOF",
        "CM" | "CF" | "TD" | "CG" | "GQ" | "GA" => "XAF",
        "AI" | "AG" | "DM" | "GD" | "MS" | "KN" | "LC" | "VC" => "XCD",
        "PF" | "NC" | "WF" => "XPF",
        "SG" => "SGD",
        "MY" => "MYR",
        "CN" => "CNY",
        "HK" => "HKD",
        "MO" => "MOP",
        "TW" => "TWD",
        "JP" => "JPY",
        "KR" => "KRW",
        "KP" => "KPW",
        "IN" => "INR",
        "ID" => "IDR",
        "TH" => "THB",
        "VN" => "VND",
        "PH" => "PHP",
        "CA" => "CAD",
        "MX" => "MXN",
        "BR" => "BRL",
        "AR" => "ARS",
        "CL" => "CLP",
        "CO" => "COP",
        "PE" => "PEN",
        "UY" => "UYU",
        "PY" => "PYG",
        "BO" => "BOB",
        "VE" => "VES",
        "ZA" => "ZAR",
        "LS" => "LSL",
        "NA" => "NAD",
        "SZ" => "SZL",
        "SE" => "SEK",
        "PL" => "PLN",
        "CZ" => "CZK",
        "HU" => "HUF",
        "RO" => "RON",
        "TR" => "TRY",
        "RU" => "RUB",
        "UA" => "UAH",
        "BY" => "BYN",
        "IS" => "ISK",
        "RS" => "RSD",
        "AL" => "ALL",
        "BA" => "BAM",
        "MK" => "MKD",
        "MD" => "MDL",
        "GE" => "GEL",
        "AM" => "AMD",
        "AZ" => "AZN",
        "KZ" => "KZT",
        "KG" => "KGS",
        "UZ" => "UZS",
        "TJ" => "TJS",
        "TM" => "TMT",
        "MN" => "MNT",
        "AE" => "AED",
        "SA" => "SAR",
        "QA" => "QAR",
        "KW" => "KWD",
        "BH" => "BHD",
        "OM" => "OMR",
        "IL" | "PS" => "ILS",
        "JO" => "JOD",
        "LB" => "LBP",
        "IQ" => "IQD",
        "IR" => "IRR",
        "SY" => "SYP",
        "YE" => "YER",
        "EG" => "EGP",
        "MA" | "EH" => "MAD",
        "DZ" => "DZD",
        "TN" => "TND",
        "LY" => "LYD",
        "SD" => "SDG",
        "SS" => "SSP",
        "ET" => "ETB",
        "ER" => "ERN",
        "DJ" => "DJF",
        "SO" => "SOS",
        "KE" => "KES",
        "UG" => "UGX",
        "TZ" => "TZS",
        "RW" => "RWF",
        "BI" => "BIF",
        "CD" => "CDF",
        "AO" => "AOA",
        "ZM" => "ZMW",
        "ZW" => "ZWG",
        "MW" => "MWK",
        "MZ" => "MZN",
        "BW" => "BWP",
        "NG" => "NGN",
        "GH" => "GHS",
        "GN" => "GNF",
        "SL" => "SLE",
        "LR" => "LRD",
        "GM" => "GMD",
        "MR" => "MRU",
        "CV" => "CVE",
        "ST" => "STN",
        "MG" => "MGA",
        "MU" => "MUR",
        "SC" => "SCR",
        "KM" => "KMF",
        "PK" => "PKR",
        "BD" => "BDT",
        "LK" => "LKR",
        "NP" => "NPR",
        "BT" => "BTN",
        "MV" => "MVR",
        "AF" => "AFN",
        "MM" => "MMK",
        "LA" => "LAK",
        "KH" => "KHR",
        "BN" => "BND",
        "PG" => "PGK",
        "FJ" => "FJD",
        "SB" => "SBD",
        "VU" => "VUV",
        "WS" => "WST",
        "TO" => "TOP",
        "GT" => "GTQ",
        "HN" => "HNL",
        "NI" => "NIO",
        "CR" => "CRC",
        "BZ" => "BZD",
        "CU" => "CUP",
        "DO" => "DOP",
        "HT" => "HTG",
        "JM" => "JMD",
        "TT" => "TTD",
        "BB" => "BBD",
        "BS" => "BSD",
        "BM" => "BMD",
        "KY" => "KYD",
        "AW" => "AWG",
        "CW" | "SX" => "XCG",
        "GY" => "GYD",
        "SR" => "SRD",
        "FK" => "FKP",
        "GI" => "GIP",
        "SH" => "SHP",
        _ => "USD",
    }
}
// No location services or network access: only OS preferences and local environment.
fn system_locale() -> Option<String> {
    #[cfg(target_os = "macos")]
    let output = std::process::Command::new("/usr/bin/defaults")
        .args(["read", "-g", "AppleLocale"])
        .output();
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-Culture).Name"])
        .output();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        output
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|locale| locale.trim().to_owned())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    None
}
fn currency_from_locales<'a>(locales: impl IntoIterator<Item = &'a str>) -> &'static str {
    locales
        .into_iter()
        .find_map(|locale| {
            // Regionless locales (including C.UTF-8/POSIX) must not mask a later region.
            // An explicit unknown region, however, deliberately falls back to USD.
            locale_region(locale).map(|_| region_currency(locale))
        })
        .unwrap_or("USD")
}
fn monetary_locales(mut lookup: impl FnMut(&str) -> Option<String>) -> Vec<String> {
    ["LC_ALL", "LC_MONETARY", "LANG"].into_iter().filter_map(&mut lookup).collect()
}
fn default_currency() -> String {
    let os_locale = system_locale();
    let environment = monetary_locales(|key| std::env::var(key).ok());
    currency_from_locales(
        os_locale.as_deref().into_iter().chain(environment.iter().map(String::as_str)),
    )
    .into()
}

fn category_values(c: &Connection) -> R<Vec<(String, String)>> {
    c.prepare("SELECT kind,name FROM categories ORDER BY kind COLLATE BINARY,name COLLATE BINARY")
        .map_err(err)?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)
}

pub struct Storage {
    pub directory: PathBuf,
}
impl Storage {
    pub fn new(directory: PathBuf) -> R<Self> {
        fs::create_dir_all(&directory).map_err(err)?;
        let storage = Self { directory };
        if !storage.directory.join("folio.sqlite").exists()
            && storage.directory.join("finance.sqlite").exists()
        {
            storage.convert_legacy(&storage.directory)?;
        }
        fs::create_dir_all(storage.directory.join("ledgers")).map_err(err)?;
        let c = storage.registry()?;
        c.execute_batch(REGISTRY).map_err(err)?;
        let count: i64 =
            c.query_row("SELECT count(*) FROM profile", [], |r| r.get(0)).map_err(err)?;
        if count == 0 {
            c.execute("INSERT INTO profile VALUES (?,'You','en-SG')", [Uuid::new_v4().to_string()])
                .map_err(err)?;
        }
        let count: i64 =
            c.query_row("SELECT count(*) FROM ledgers", [], |r| r.get(0)).map_err(err)?;
        if count == 0 {
            storage.create_ledger(&json!({"name":"Default"}))?;
        }
        storage.connection()?;
        Ok(storage)
    }
    fn registry(&self) -> R<Connection> {
        let c = Connection::open(self.directory.join("folio.sqlite")).map_err(err)?;
        configure(&c)?;
        Ok(c)
    }
    fn ledger_path(&self, value: &str) -> R<PathBuf> {
        id(value)?;
        Ok(self.directory.join("ledgers").join(format!("{value}.sqlite")))
    }
    fn active(&self, c: &Connection) -> R<String> {
        c.query_row("SELECT l.id FROM ledgers l JOIN app_settings s ON s.value=l.id WHERE s.key='selected_ledger'", [], |r| r.get(0)).map_err(err)
    }
    pub fn connection(&self) -> R<Connection> {
        let c = self.registry()?;
        let active = self.active(&c)?;
        let path = self.ledger_path(&active)?;
        if !path.is_file() {
            return Err("Ledger database is missing.".into());
        }
        migrate(&path)
    }
    pub fn settings(&self) -> R<Value> {
        let c = self.registry()?;
        let profile = c.query_row("SELECT id,username,language FROM profile", [], |r| Ok(json!({"id":r.get::<_,String>(0)?,"username":r.get::<_,String>(1)?,"language":r.get::<_,String>(2)?}))).map_err(err)?;
        let ledgers = c.prepare("SELECT id,name,currency FROM ledgers ORDER BY rowid").map_err(err)?.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"currency":r.get::<_,String>(2)?}))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
        let active = self.active(&c)?;
        let ledger = ledgers
            .iter()
            .find(|l| l["id"] == active)
            .cloned()
            .ok_or("Selected ledger is missing.")?;
        Ok(
            json!({"profile":profile,"ledger":ledger,"ledgers":ledgers,"defaultCurrency":default_currency()}),
        )
    }
    pub fn update_profile(&self, form: &Value) -> R<Value> {
        let username = text(form, "username", 80)?;
        let language = text(form, "language", 35)?;
        if !["en-SG", "zh-SG", "ms-MY"].contains(&language) {
            return Err("Choose a supported language.".into());
        }
        self.registry()?
            .execute("UPDATE profile SET username=?,language=?", params![username, language])
            .map_err(err)?;
        self.settings()
    }
    pub fn create_ledger(&self, form: &Value) -> R<Value> {
        let name = text(form, "name", 80)?;
        let detected = default_currency();
        let unit = if form.get("currency").is_none() || form["currency"].is_null() {
            detected.as_str()
        } else {
            field(form, "currency")
        };
        currency(unit)?;
        let ledger = Uuid::new_v4().to_string();
        let path = self.ledger_path(&ledger)?;
        let mut ledger_connection = Connection::open(&path).map_err(err)?;
        configure(&ledger_connection)?;
        crate::commands::shared::initialize(&ledger_connection)?;
        let schema = ledger_connection.transaction().map_err(err)?;
        schema
            .execute_batch(
                "CREATE TABLE _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
            )
            .map_err(err)?;
        for &(migration, sql) in MIGRATIONS {
            schema
                .execute(
                    "INSERT INTO _migrations VALUES (?,?)",
                    params![migration, format!("{:x}", Sha256::digest(sql.as_bytes()))],
                )
                .map_err(err)?;
        }
        schema.commit().map_err(err)?;
        drop(ledger_connection);
        let mut c = self.registry()?;
        let tx = c.transaction().map_err(err)?;
        tx.execute("INSERT INTO ledgers VALUES (?,?,?)", params![ledger, name, unit])
            .map_err(err)?;
        tx.execute("INSERT OR REPLACE INTO app_settings VALUES ('selected_ledger',?)", [&ledger])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.settings()
    }
    pub fn update_ledger(&self, form: &Value) -> R<Value> {
        let ledger = field(form, "id");
        id(ledger)?;
        let name = text(form, "name", 80)?;
        let c = self.registry()?;
        if c.execute("UPDATE ledgers SET name=? WHERE id=?", params![name, ledger]).map_err(err)?
            != 1
        {
            return Err("Ledger not found.".into());
        }
        self.settings()
    }
    pub fn switch_ledger(&self, form: &Value) -> R<Value> {
        let ledger = field(form, "id");
        let path = self.ledger_path(ledger)?;
        let c = self.registry()?;
        let exists: bool = c
            .query_row("SELECT EXISTS(SELECT 1 FROM ledgers WHERE id=?)", [ledger], |r| r.get(0))
            .map_err(err)?;
        if !exists || !path.is_file() {
            return Err("Ledger not found.".into());
        }
        migrate(&path)?;
        c.execute("INSERT OR REPLACE INTO app_settings VALUES ('selected_ledger',?)", [ledger])
            .map_err(err)?;
        self.settings()
    }
    pub fn delete_ledger(&self, form: &Value) -> R<Value> {
        self.delete_ledger_with_cleanup(form, |path| fs::remove_file(path))
    }
    fn delete_ledger_with_cleanup(
        &self,
        form: &Value,
        mut remove_file: impl FnMut(&Path) -> std::io::Result<()>,
    ) -> R<Value> {
        if field(form, "confirmation") != "DELETE" {
            return Err("Type DELETE to confirm ledger deletion.".into());
        }
        let ledger = field(form, "id");
        let path = self.ledger_path(ledger)?;
        let mut c = self.registry()?;
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
        let count: i64 =
            tx.query_row("SELECT count(*) FROM ledgers", [], |r| r.get(0)).map_err(err)?;
        if count <= 1 {
            return Err("The last ledger cannot be deleted.".into());
        }
        let exists: bool = tx
            .query_row("SELECT EXISTS(SELECT 1 FROM ledgers WHERE id=?)", [ledger], |r| r.get(0))
            .map_err(err)?;
        if !exists {
            return Err("Ledger not found.".into());
        }
        let backups = self.directory.join("backups");
        fs::create_dir_all(&backups).map_err(err)?;
        backup(&path, &backups.join(format!("{ledger}-{}.sqlite", Uuid::new_v4())))?;
        tx.execute("DELETE FROM ledgers WHERE id=?", [ledger]).map_err(err)?;
        tx.execute("UPDATE app_settings SET value=(SELECT id FROM ledgers ORDER BY rowid LIMIT 1) WHERE key='selected_ledger' AND value=?",[ledger]).map_err(err)?;
        tx.commit().map_err(err)?;
        // Metadata is committed first: a crash can leave only an unreferenced database, never a broken ledger.
        let mut cleanup_errors = Vec::new();
        for suffix in ["", "-wal", "-shm"] {
            let file = PathBuf::from(format!("{}{suffix}", path.display()));
            if let Err(error) = remove_file(&file)
                && error.kind() != std::io::ErrorKind::NotFound
            {
                cleanup_errors.push(format!("{}: {error}", file.display()));
            }
        }
        let mut settings = self.settings()?;
        if !cleanup_errors.is_empty() {
            settings["warning"] = json!(format!(
                "Ledger deleted and backed up, but some database files could not be removed: {}",
                cleanup_errors.join("; ")
            ));
        }
        Ok(settings)
    }
    fn unused(&self) -> R<()> {
        let settings = self.settings()?;
        if settings["ledgers"].as_array().map(Vec::len) != Some(1)
            || settings["ledger"]["name"] != "Default"
            || settings["profile"]["username"] != "You"
        {
            return Err("Import requires an unused default ledger.".into());
        }
        let c = self.connection()?;
        for table in [
            "accounts",
            "transactions",
            "budgets",
            "subscriptions",
            "goals",
            "contributions",
            "receipts",
            "ledger_cover",
            "receipt_files",
        ] {
            let count: i64 = c
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .map_err(err)?;
            if count != 0 {
                return Err("Import requires an unused default ledger.".into());
            }
        }
        // Compare semantic category values, not generated IDs, against the canonical seed.
        let pristine = Connection::open_in_memory().map_err(err)?;
        crate::commands::shared::initialize(&pristine)?;
        if category_values(&c)? != category_values(&pristine)? {
            return Err("Import requires the pristine default category set; customized categories are present.".into());
        }
        Ok(())
    }
    pub fn import_legacy(&self, source: &str) -> R<Value> {
        let source = Path::new(source);
        reject_links(source)?;
        let source = source.canonicalize().map_err(err)?;
        reject_links(&self.directory)?;
        let target = self.directory.canonicalize().map_err(err)?;
        if source.starts_with(&target) || target.starts_with(&source) {
            return Err("Source and target must be separate directories.".into());
        }
        self.unused()?;
        self.convert_legacy(&source)?;
        self.settings()
    }
    fn convert_legacy(&self, source: &Path) -> R<()> {
        reject_links(source)?;
        let stage = self.directory.join(format!(".storage-stage-{}", Uuid::new_v4()));
        fs::create_dir(&stage).map_err(err)?;
        let result = (|| {
            let snapshots = stage.join("legacy-backup");
            fs::create_dir(&snapshots).map_err(err)?;
            // Snapshot all sources (including orphaned profiles) before touching schemas.
            backup(&source.join("finance.sqlite"), &snapshots.join("finance.sqlite"))?;
            if source.join("profiles").exists() {
                fs::create_dir(snapshots.join("profiles")).map_err(err)?;
                for entry in fs::read_dir(source.join("profiles")).map_err(err)? {
                    let entry = entry.map_err(err)?;
                    if entry.path().extension().and_then(|s| s.to_str()) == Some("sqlite") {
                        backup(&entry.path(), &snapshots.join("profiles").join(entry.file_name()))?;
                    } else if entry.file_type().map_err(err)?.is_file()
                        && !entry.file_name().to_string_lossy().ends_with("-wal")
                        && !entry.file_name().to_string_lossy().ends_with("-shm")
                    {
                        fs::copy(entry.path(), snapshots.join("profiles").join(entry.file_name()))
                            .map_err(err)?;
                    }
                }
            }
            if source.join("receipts").exists() {
                copy_tree(&source.join("receipts"), &snapshots.join("receipts"))?;
            }
            let old = Connection::open(snapshots.join("finance.sqlite")).map_err(err)?;
            let has_profiles: bool = old.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_profiles')",[],|r|r.get(0)).map_err(err)?;
            let profiles: Vec<(String, String, String, String, i64)> = if has_profiles {
                old.prepare("SELECT id,username,language,currency,legacy FROM local_profiles ORDER BY rowid").map_err(err)?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(err)?.collect::<Result<_,_>>().map_err(err)?
            } else {
                Vec::new()
            };
            if snapshots.join("profiles").exists() {
                let mut unreferenced = Vec::new();
                for entry in fs::read_dir(snapshots.join("profiles")).map_err(err)? {
                    let entry = entry.map_err(err)?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if entry.path().extension().and_then(|s| s.to_str()) == Some("sqlite")
                        && !profiles.iter().any(|p| p.4 == 0 && name == format!("{}.sqlite", p.0))
                    {
                        unreferenced.push(format!("profiles/{name}"));
                    }
                }
                if !unreferenced.is_empty() {
                    unreferenced.sort();
                    return Err(format!(
                        "Unreferenced legacy profile databases: {}. Resolve or recover these databases before converting.",
                        unreferenced.join(", ")
                    ));
                }
            }
            let selected: Option<String> = if has_profiles {
                old.query_row(
                    "SELECT value FROM native_settings WHERE key='selected_profile'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?
            } else {
                None
            };
            let active = profiles
                .iter()
                .find(|p| Some(&p.0) == selected.as_ref())
                .or_else(|| profiles.first());
            let registry = Connection::open(stage.join("folio.sqlite")).map_err(err)?;
            registry.execute_batch(REGISTRY).map_err(err)?;
            if let Some(p) = active {
                registry
                    .execute("INSERT INTO profile VALUES (?,?,?)", params![p.0, p.1, p.2])
                    .map_err(err)?;
            } else {
                registry
                    .execute(
                        "INSERT INTO profile VALUES (?,'You','en-SG')",
                        [Uuid::new_v4().to_string()],
                    )
                    .map_err(err)?;
            }
            fs::create_dir(stage.join("ledgers")).map_err(err)?;
            let mut ledger_sources = Vec::new();
            for p in &profiles {
                id(&p.0)?;
                if p.4 != 0 && p.4 != 1 {
                    return Err("Invalid legacy profile flag.".into());
                }
                let path = if p.4 == 1 {
                    snapshots.join("finance.sqlite")
                } else {
                    snapshots.join("profiles").join(format!("{}.sqlite", p.0))
                };
                ledger_sources.push((p.0.clone(), p.1.clone(), p.3.clone(), path));
            }
            // A registry may contain finance data even when no profile points to it.
            if !profiles.iter().any(|p| p.4 == 1) {
                let has_data: bool = old
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='wallets')",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let nonempty = if has_data {
                    let mut found = false;
                    for table in [
                        "wallets",
                        "entries",
                        "budgets",
                        "subscriptions",
                        "goals",
                        "receipts",
                        "workspace_cover",
                    ] {
                        let exists: bool = old
                            .query_row(
                                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?)",
                                [table],
                                |r| r.get(0),
                            )
                            .map_err(err)?;
                        if exists {
                            let count: i64 = old
                                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| {
                                    r.get(0)
                                })
                                .map_err(err)?;
                            found |= count > 0;
                        }
                    }
                    found
                } else {
                    false
                };
                if profiles.is_empty() || nonempty {
                    ledger_sources.push((
                        Uuid::new_v4().to_string(),
                        "Default".into(),
                        if has_data {
                            old.query_row(
                                "SELECT currency FROM wallets ORDER BY rowid LIMIT 1",
                                [],
                                |r| r.get::<_, String>(0),
                            )
                            .optional()
                            .map_err(err)?
                            .unwrap_or_else(|| "SGD".into())
                        } else {
                            "SGD".into()
                        },
                        snapshots.join("finance.sqlite"),
                    ));
                }
            }
            if self.directory.join("folio.sqlite").exists() {
                let current = self.registry()?;
                for (ledger, _, _, _) in &ledger_sources {
                    let referenced: bool = current
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM ledgers WHERE id=?)",
                            [ledger],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    if referenced {
                        return Err("Imported ledger ID conflicts with an existing ledger.".into());
                    }
                }
            }
            for (ledger, name, unit, path) in &ledger_sources {
                let target = stage.join("ledgers").join(format!("{ledger}.sqlite"));
                backup(path, &target)?;
                let mut c = migrate(&target)?;
                let receipts = c.prepare("SELECT r.id,r.size FROM receipts r LEFT JOIN receipt_files f ON f.id=r.id WHERE f.id IS NULL").map_err(err)?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
                let tx = c.transaction().map_err(err)?;
                for (receipt, size) in receipts {
                    id(&receipt)?;
                    let bytes = fs::read(snapshots.join("receipts").join(&receipt)).map_err(err)?;
                    if bytes.len() as i64 != size {
                        return Err(format!("Receipt size mismatch: {receipt}"));
                    }
                    tx.execute("INSERT INTO receipt_files VALUES (?,?)", params![receipt, bytes])
                        .map_err(err)?;
                }
                tx.commit().map_err(err)?;
                validate(&c)?;
                c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").map_err(err)?;
                registry
                    .execute("INSERT INTO ledgers VALUES (?,?,?)", params![ledger, name, unit])
                    .map_err(err)?;
            }
            let chosen = active
                .map(|p| p.0.clone())
                .or_else(|| ledger_sources.first().map(|p| p.0.clone()))
                .ok_or("No ledgers to import.")?;
            registry
                .execute("INSERT INTO app_settings VALUES ('selected_ledger',?)", [chosen])
                .map_err(err)?;
            validate(&registry)?;
            drop(registry);
            drop(old);
            fs::create_dir_all(self.directory.join("ledgers")).map_err(err)?;
            // UUID filenames make retries safe; the registry is the sole publication marker.
            for (ledger, _, _, _) in &ledger_sources {
                let name = format!("{ledger}.sqlite");
                let target = self.directory.join("ledgers").join(&name);
                if target.exists() {
                    backup(&target, &stage.join(format!("previous-{name}")))?;
                }
                fs::rename(stage.join("ledgers").join(&name), target).map_err(err)?;
            }
            let backups = self.directory.join("backups");
            fs::create_dir_all(&backups).map_err(err)?;
            fs::rename(&snapshots, backups.join(format!("legacy-{}", Uuid::new_v4())))
                .map_err(err)?;
            if self.directory.join("folio.sqlite").exists() {
                backup(
                    &self.directory.join("folio.sqlite"),
                    &backups.join(format!("registry-{}.sqlite", Uuid::new_v4())),
                )?;
                let c = self.registry()?;
                c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
                    .map_err(err)?;
                drop(c);
            }
            fs::rename(stage.join("folio.sqlite"), self.directory.join("folio.sqlite"))
                .map_err(err)?;
            Ok(())
        })();
        let _ = fs::remove_dir_all(&stage);
        result
    }
}

// Reject links throughout the source tree and ancestors before opening SQLite.
fn reject_links(path: &Path) -> R<()> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor).map_err(err)?.file_type().is_symlink() {
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
            // macOS temporary paths can have a symlinked /var ancestor.
                        let p = fs::canonicalize(std::env::temp_dir())
                            .unwrap()
                            .join(format!("folio-storage-test-{}", Uuid::new_v4()));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn defaults_isolation_and_restart() {
        let temp = Temp::new();
        let s = Storage::new(temp.0.clone()).unwrap();
        let initial = s.settings().unwrap();
        assert_eq!(initial["profile"]["username"], "You");
        assert_eq!(initial["ledger"]["name"], "Default");
        let first = initial["ledger"]["id"].as_str().unwrap();
        let updated = s.update_profile(&json!({"username":"Ada","language":"zh-SG"})).unwrap();
        assert_eq!(updated["profile"]["id"], initial["profile"]["id"]);
        s.connection()
            .unwrap()
            .execute("INSERT INTO goals VALUES ('g','Saved',100,'2030-01-01')", [])
            .unwrap();
        let second = s.create_ledger(&json!({"name":"Travel","currency":"JPY"})).unwrap();
        assert_eq!(second["ledger"]["currency"], "JPY");
        assert_eq!(
            s.connection()
                .unwrap()
                .query_row("SELECT count(*) FROM goals", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        let other = second["ledger"]["id"].as_str().unwrap();
        s.update_ledger(&json!({"id":other,"name":"Trips"})).unwrap();
        s.switch_ledger(&json!({"id":first})).unwrap();
        let restarted = Storage::new(temp.0.clone()).unwrap();
        assert_eq!(restarted.settings().unwrap()["ledger"]["id"], first);
        assert_eq!(
            restarted
                .connection()
                .unwrap()
                .query_row("SELECT count(*) FROM goals", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(s.delete_ledger(&json!({"id":first,"confirmation":"yes"})).is_err());
        let deleted = s.delete_ledger(&json!({"id":first,"confirmation":"DELETE"})).unwrap();
        assert_eq!(deleted["ledger"]["id"], other);
        assert!(deleted.get("warning").is_none());
        assert!(s.delete_ledger(&json!({"id":other,"confirmation":"DELETE"})).is_err());
        assert!(fs::read_dir(temp.0.join("backups")).unwrap().next().is_some());
        assert!(s.switch_ledger(&json!({"id":"../finance"})).is_err());
        assert!(s.create_ledger(&json!({"name":"Bad","currency":"ZZZ"})).is_err());
    }
    #[test]
    fn currencies_and_regions() {
        for c in ["USD", "JPY", "INR", "CHF", "KWD", "XAF", "NZD", "XCG", "ZWG"] {
            currency(c).unwrap();
        }
        assert!(currency("usd").is_err());
        for (locale, unit) in [
            ("en_SG", "SGD"),
            ("en_SG.UTF-8", "SGD"),
            ("en_SG@currency=USD", "SGD"),
            ("en_001", "USD"),
            ("unknown", "USD"),
            ("C.UTF-8", "USD"),
            ("de-DE", "EUR"),
            ("en_IN", "INR"),
            ("fr_CA", "CAD"),
            ("zh_Hant_TW", "TWD"),
            ("en_ZZ", "USD"),
            ("C", "USD"),
        ] {
            assert_eq!(region_currency(locale), unit);
        }
    }
    #[test]
    fn regional_settings_precede_shell_and_neutral_locales_fall_through() {
        for (locales, expected) in [
            (vec!["en_SG", "en_US.UTF-8"], "SGD"),
            (vec!["zh_Hant_TW", "en_US.UTF-8"], "TWD"),
            (vec!["en_SG@currency=USD", "en_US"], "SGD"),
            (vec!["C.UTF-8", "en_SG"], "SGD"),
            (vec!["C.UTF8", "POSIX", "", "zh_Hant_TW"], "TWD"),
            (vec!["en_001", "en_SG"], "USD"),
            (vec!["en_ZZ", "en_SG"], "USD"),
            (vec!["unknown", "C.UTF-8"], "USD"),
            (vec![], "USD"),
        ] {
            assert_eq!(currency_from_locales(locales), expected);
        }
    }
    #[test]
    fn singleton_profile_is_enforced_in_new_and_existing_registries() {
        let temp = Temp::new();
        let storage = Storage::new(temp.0.clone()).unwrap();
        let original = storage.settings().unwrap()["profile"].clone();
        let c = storage.registry().unwrap();
        // Simulate a registry created before singleton constraints were introduced.
        c.execute_batch("DROP INDEX profile_singleton; DROP TRIGGER profile_prevent_second_insert; DROP TRIGGER profile_prevent_delete;").unwrap();
        drop(c);
        let storage = Storage::new(temp.0.clone()).unwrap();
        let c = storage.registry().unwrap();
        assert!(
            c.execute(
                "INSERT INTO profile VALUES (?,'Second','en-SG')",
                [Uuid::new_v4().to_string()]
            )
            .is_err()
        );
        assert!(
            c.execute(
                "INSERT OR REPLACE INTO profile VALUES (?,'Replacement','en-SG')",
                [original["id"].as_str().unwrap()]
            )
            .is_err()
        );
        assert!(c.execute("DELETE FROM profile", []).is_err());
        assert_eq!(storage.settings().unwrap()["profile"], original);
        storage.update_profile(&json!({"username":"Updated","language":"ms-MY"})).unwrap();
        assert_eq!(storage.settings().unwrap()["profile"]["id"], original["id"]);
    }
    #[test]
    fn monetary_environment_precedence_ignores_message_locale() {
        for (variables, expected) in [
            (vec![("LC_ALL", "en_SG"), ("LC_MONETARY", "de_DE"), ("LANG", "en_US")], "SGD"),
            (
                vec![("LC_MONETARY", "de_DE"), ("LC_MESSAGES", "en_US"), ("LANG", "zh_Hant_TW")],
                "EUR",
            ),
            (vec![("LC_ALL", "C.UTF-8"), ("LC_MONETARY", "en_SG"), ("LANG", "en_US")], "SGD"),
            (
                vec![("LC_MONETARY", "POSIX"), ("LC_MESSAGES", "en_US"), ("LANG", "zh_Hant_TW")],
                "TWD",
            ),
            (vec![("LC_MESSAGES", "en_SG")], "USD"),
        ] {
            let locales = monetary_locales(|key| {
                variables
                    .iter()
                    .find(|(name, _)| *name == key)
                    .map(|(_, value)| (*value).to_owned())
            });
            assert_eq!(currency_from_locales(locales.iter().map(String::as_str)), expected);
        }
    }
    #[test]
    fn import_rejects_every_kind_of_category_customization() {
        let source = Temp::new();
        legacy(&source.0);
        for sql in [
            "UPDATE categories SET name='Custom food' WHERE id='expense-0'",
            "UPDATE categories SET name='food & dining' WHERE id='expense-0'",
            "DELETE FROM categories WHERE id='expense-0'",
            "INSERT INTO categories VALUES ('custom','expense','Custom')",
            "UPDATE categories SET kind='income' WHERE id='expense-0'",
        ] {
            let target = Temp::new();
            let storage = Storage::new(target.0.clone()).unwrap();
            let c = storage.connection().unwrap();
            c.execute_batch(sql).unwrap();
            let before = category_values(&c).unwrap();
            let settings = storage.settings().unwrap();
            let error = storage.import_legacy(source.0.to_str().unwrap()).unwrap_err();
            assert!(error.contains("default category set"), "{error}");
            assert_eq!(category_values(&storage.connection().unwrap()).unwrap(), before);
            assert_eq!(storage.settings().unwrap(), settings);
        }
        let target = Temp::new();
        let storage = Storage::new(target.0.clone()).unwrap();
        storage
            .connection()
            .unwrap()
            .execute("UPDATE categories SET id='changed-' || id", [])
            .unwrap();
        storage.unused().unwrap();
    }
    #[test]
    fn deletion_cleanup_failure_is_success_with_warning_and_backup() {
        let temp = Temp::new();
        let storage = Storage::new(temp.0.clone()).unwrap();
        let original = storage.settings().unwrap()["ledger"]["id"].as_str().unwrap().to_owned();
        let created = storage.create_ledger(&json!({"name":"Delete me"})).unwrap();
        let ledger = created["ledger"]["id"].as_str().unwrap();
        let mut attempted = Vec::new();
        let result = storage
            .delete_ledger_with_cleanup(&json!({"id":ledger,"confirmation":"DELETE"}), |path| {
                attempted.push(path.to_owned());
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "simulated cleanup failure",
                ))
            })
            .unwrap();
        assert_eq!(result["ledger"]["id"], original);
        assert_eq!(result["ledgers"].as_array().unwrap().len(), 1);
        assert!(result["warning"].as_str().unwrap().contains("simulated cleanup failure"));
        assert_eq!(attempted.len(), 3);
        assert!(storage.ledger_path(ledger).unwrap().exists());
        let backups: Vec<_> = fs::read_dir(temp.0.join("backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1);
        validate(&Connection::open(&backups[0]).unwrap()).unwrap();
        assert_eq!(
            Storage::new(temp.0.clone()).unwrap().settings().unwrap()["ledger"]["id"],
            original
        );
    }
    #[test]
    fn deletion_backup_failure_keeps_ledger_registered() {
        let temp = Temp::new();
        let storage = Storage::new(temp.0.clone()).unwrap();
        let created = storage.create_ledger(&json!({"name":"Keep me"})).unwrap();
        let ledger = created["ledger"]["id"].as_str().unwrap();
        fs::write(temp.0.join("backups"), b"not a directory").unwrap();
        assert!(storage.delete_ledger(&json!({"id":ledger,"confirmation":"DELETE"})).is_err());
        assert_eq!(storage.settings().unwrap(), created);
        assert!(storage.ledger_path(ledger).unwrap().exists());
    }
    #[test]
    fn conversion_rejects_unreferenced_profile_databases_and_can_retry() {
        let source = Temp::new();
        legacy(&source.0);
        fs::create_dir(source.0.join("profiles")).unwrap();
        let names: Vec<_> = (0..2).map(|_| format!("{}.sqlite", Uuid::new_v4())).collect();
        for name in &names {
            backup(&source.0.join("finance.sqlite"), &source.0.join("profiles").join(name))
                .unwrap();
        }
        let error = match Storage::new(source.0.clone()) {
            Ok(_) => panic!("Orphans must prevent conversion"),
            Err(error) => error,
        };
        assert!(error.contains("Unreferenced legacy profile databases"));
        for name in &names {
            assert!(error.contains(&format!("profiles/{name}")));
        }
        assert!(!source.0.join("folio.sqlite").exists());
        let target = Temp::new();
        let storage = Storage::new(target.0.clone()).unwrap();
        let before = storage.settings().unwrap();
        assert!(
            storage.import_legacy(source.0.to_str().unwrap()).unwrap_err().contains("Unreferenced")
        );
        assert_eq!(storage.settings().unwrap(), before);
        for name in &names {
            fs::remove_file(source.0.join("profiles").join(name)).unwrap();
        }
        Storage::new(source.0.clone()).unwrap();
    }
    fn legacy(path: &Path) {
        let c = Connection::open(path.join("finance.sqlite")).unwrap();
        c.execute_batch("CREATE TABLE _migrations (name TEXT PRIMARY KEY,checksum TEXT NOT NULL)")
            .unwrap();
        for (name, sql) in &MIGRATIONS[..8] {
            c.execute_batch(sql).unwrap();
            c.execute(
                "INSERT INTO _migrations VALUES (?,?)",
                params![name, format!("{:x}", Sha256::digest(sql.as_bytes()))],
            )
            .unwrap();
        }
        c.execute_batch("CREATE TABLE local_profiles (id TEXT PRIMARY KEY,username TEXT,language TEXT,currency TEXT,legacy INTEGER); CREATE TABLE native_settings(key TEXT PRIMARY KEY,value TEXT);").unwrap();
        c.execute("INSERT INTO goals VALUES ('old','Legacy goal',100,'2030-01-01')", []).unwrap();
    }
    #[test]
    fn automatic_legacy_conversion_and_idempotence() {
        let temp = Temp::new();
        legacy(&temp.0);
        let profile = Uuid::new_v4().to_string();
        let c = Connection::open(temp.0.join("finance.sqlite")).unwrap();
        c.execute("INSERT INTO local_profiles VALUES (?,'Old name','ms-MY','MYR',1)", [&profile])
            .unwrap();
        c.execute("INSERT INTO native_settings VALUES ('selected_profile',?)", [&profile]).unwrap();
        drop(c);
        let s = Storage::new(temp.0.clone()).unwrap();
        let settings = s.settings().unwrap();
        assert_eq!(settings["profile"]["username"], "Old name");
        assert_eq!(settings["ledger"]["currency"], "MYR");
        assert_eq!(
            s.connection()
                .unwrap()
                .query_row("SELECT name FROM goals", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Legacy goal"
        );
        assert_eq!(Storage::new(temp.0.clone()).unwrap().settings().unwrap(), settings);
        let old = Connection::open(temp.0.join("finance.sqlite")).unwrap();
        assert!(old.prepare("SELECT * FROM wallets").is_ok());
        assert!(old.prepare("SELECT * FROM accounts").is_err());
        assert!(old.prepare("SELECT * FROM local_profiles").is_ok());
        assert!(old.prepare("SELECT * FROM native_settings").is_ok());
        let ledger = s.connection().unwrap();
        for table in [
            "local_profiles",
            "native_settings",
            "user",
            "session",
            "account",
            "verification",
            "login_attempts",
        ] {
            let exists: bool = ledger
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(!exists, "Legacy metadata table leaked into ledger: {table}");
        }
    }
    #[test]
    fn all_profiles_and_receipts_survive_conversion() {
        let source = Temp::new();
        legacy(&source.0);
        fs::create_dir(source.0.join("profiles")).unwrap();
        fs::create_dir(source.0.join("receipts")).unwrap();
        let first = Uuid::new_v4().to_string();
        let second = Uuid::new_v4().to_string();
        let receipt = Uuid::new_v4().to_string();
        let c = Connection::open(source.0.join("finance.sqlite")).unwrap();
        c.execute("INSERT INTO local_profiles VALUES (?,'Registry','en-SG','SGD',1)", [&first])
            .unwrap();
        c.execute("INSERT INTO local_profiles VALUES (?,'Personal','zh-SG','JPY',0)", [&second])
            .unwrap();
        c.execute("INSERT INTO native_settings VALUES ('selected_profile',?)", [&second]).unwrap();
        c.execute("INSERT INTO wallets VALUES ('a','Cash',0,'SGD',0)", []).unwrap();
        c.execute("INSERT INTO entries VALUES ('t','expense','2026-01-01','Receipt',100,'a',NULL,'Other','',NULL)",[]).unwrap();
        c.execute("INSERT INTO receipts VALUES (?,'t','receipt.txt','text/plain',5)", [&receipt])
            .unwrap();
        fs::write(source.0.join("receipts").join(&receipt), b"hello").unwrap();
        backup(
            &source.0.join("finance.sqlite"),
            &source.0.join("profiles").join(format!("{second}.sqlite")),
        )
        .unwrap();
        drop(c);
        let target = Temp::new();
        let s = Storage::new(target.0.clone()).unwrap();
        let imported = s.import_legacy(source.0.to_str().unwrap()).unwrap();
        assert_eq!(imported["profile"]["id"], second);
        assert_eq!(imported["profile"]["language"], "zh-SG");
        assert_eq!(imported["ledgers"].as_array().unwrap().len(), 2);
        for ledger in [&first, &second] {
            s.switch_ledger(&json!({"id":ledger})).unwrap();
            let c = s.connection().unwrap();
            assert_eq!(
                c.query_row("SELECT bytes FROM receipt_files WHERE id=?", [&receipt], |r| r
                    .get::<_, Vec<u8>>(0))
                    .unwrap(),
                b"hello"
            );
            assert!(c.prepare("SELECT transaction_id FROM receipts").is_ok());
            assert!(
                c.prepare("SELECT account_id,destination_account_id FROM transactions").is_ok()
            );
        }
        assert_eq!(fs::read(source.0.join("receipts").join(&receipt)).unwrap(), b"hello");
    }
    #[test]
    fn failed_conversion_is_retryable_and_sources_unchanged() {
        let source = Temp::new();
        legacy(&source.0);
        let c = Connection::open(source.0.join("finance.sqlite")).unwrap();
        c.execute("UPDATE _migrations SET checksum='changed' WHERE name='0001_initial.sql'", [])
            .unwrap();
        drop(c);
        assert!(Storage::new(source.0.clone()).is_err());
        assert!(!source.0.join("folio.sqlite").exists());
        let c = Connection::open(source.0.join("finance.sqlite")).unwrap();
        c.execute(
            "UPDATE _migrations SET checksum=? WHERE name='0001_initial.sql'",
            [format!("{:x}", Sha256::digest(MIGRATIONS[0].1.as_bytes()))],
        )
        .unwrap();
        drop(c);
        Storage::new(source.0.clone()).unwrap();
    }
    #[test]
    fn explicit_import_and_nonempty_rejection() {
        let source = Temp::new();
        legacy(&source.0);
        let target = Temp::new();
        let s = Storage::new(target.0.clone()).unwrap();
        let imported = s.import_legacy(source.0.to_str().unwrap()).unwrap();
        assert_eq!(imported["ledger"]["name"], "Default");
        assert_eq!(
            s.connection()
                .unwrap()
                .query_row("SELECT count(*) FROM goals", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(s.import_legacy(source.0.to_str().unwrap()).is_err());
        assert!(s.import_legacy(target.0.to_str().unwrap()).is_err());
    }
}
