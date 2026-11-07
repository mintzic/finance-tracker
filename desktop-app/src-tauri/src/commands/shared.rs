pub(super) use chrono::{Datelike, Duration, NaiveDate, Utc};
pub(super) use rusqlite::{Connection, Params, params, types::ValueRef};
pub(super) use serde_json::{Map, Value, json};
pub(super) use uuid::Uuid;
pub(super) type R<T> = Result<T, String>;
pub(super) const MAX: i64 = 999_999_999_999;
pub(super) fn uid() -> String {
    Uuid::new_v4().to_string()
}
pub(super) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub(super) fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub(super) fn text(v: &Value, key: &str, max: usize) -> R<String> {
    let s = field(v, key).trim();
    if s.is_empty() || s.encode_utf16().count() > max {
        return Err(format!("Enter {} (up to {max} characters).", key.replace('_', " ")));
    }
    Ok(s.to_owned())
}
pub(super) fn minor(s: &str) -> R<i64> {
    let s = s.trim();
    let neg = s.starts_with('-');
    let raw = s.strip_prefix('-').unwrap_or(s);
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() > 2
        || parts[0].is_empty()
        || parts[0].len() > 10
        || !parts[0].bytes().all(|b| b.is_ascii_digit())
        || (parts.len() == 2
            && (parts[1].is_empty()
                || parts[1].len() > 2
                || !parts[1].bytes().all(|b| b.is_ascii_digit())))
    {
        return Err("Enter a valid amount with at most two decimal places.".into());
    }
    let whole = parts[0].parse::<i64>().map_err(err)?;
    let fraction = if parts.len() == 2 {
        format!("{:<02}", parts[1]).replace(' ', "0").parse::<i64>().map_err(err)?
    } else {
        0
    };
    let n = whole * 100 + fraction;
    if n > MAX {
        return Err("Amount is too large.".into());
    }
    Ok(if neg { -n } else { n })
}
pub(super) fn positive(v: &Value) -> R<i64> {
    let n = minor(&text(v, "amount", 200)?)?;
    if n <= 0 { Err("Amount must be greater than zero.".into()) } else { Ok(n) }
}
pub(super) fn decimal(n: i64) -> String {
    format!("{}{}.{:02}", if n < 0 { "-" } else { "" }, n.abs() / 100, n.abs() % 100)
}
pub(super) fn date(s: &str) -> R<NaiveDate> {
    let d =
        NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Enter a valid date.".to_string())?;
    if s.len() != 10 || d.to_string() != s || d.year() < 1900 || d.year() > 9999 {
        return Err("Enter a valid date.".into());
    }
    Ok(d)
}
pub(super) fn today() -> String {
    (Utc::now() + Duration::hours(8)).date_naive().to_string()
}
pub(super) fn month_range(s: &str) -> R<(String, String)> {
    if s.len() != 7 || !("1900-01"..="9998-12").contains(&s) {
        return Err("Invalid month.".into());
    }
    let d = date(&format!("{s}-01")).map_err(|_| "Invalid month.".to_string())?;
    let next = if d.month() == 12 {
        NaiveDate::from_ymd_opt(d.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(d.year(), d.month() + 1, 1)
    }
    .ok_or("Invalid month.")?;
    Ok((d.to_string(), next.to_string()))
}
pub(super) fn query<P: Params>(c: &Connection, sql: &str, p: P) -> R<Vec<Value>> {
    let mut st = c.prepare(sql).map_err(err)?;
    let names: Vec<_> = st.column_names().map(|s| s.to_string()).collect();
    let rows = st
        .query_map(p, |r| {
            let mut m = Map::new();
            for (i, n) in names.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(s) => json!(String::from_utf8_lossy(s)),
                    ValueRef::Blob(b) => json!(b),
                };
                m.insert(n.clone(), v);
            }
            Ok(Value::Object(m))
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
pub(super) fn one<P: Params>(c: &Connection, sql: &str, p: P) -> R<Value> {
    Ok(query(c, sql, p)?.into_iter().next().unwrap_or(Value::Null))
}
pub(super) fn record(c: &Connection, table: &str, id: &str) -> R<Value> {
    let v = one(c, &format!("SELECT * FROM {table} WHERE id=?"), [id])?;
    if v.is_null() { Err("Record not found.".into()) } else { Ok(v) }
}
pub(super) fn exec<P: Params>(c: &Connection, sql: &str, p: P) -> R<usize> {
    c.execute(sql, p).map_err(err)
}
pub(super) fn category(c: &Connection, kind: &str, name: &str) -> R<()> {
    // Legacy validation is exact-case even though category names are unique NOCASE.
    if one(
        c,
        "SELECT id FROM categories WHERE kind=? AND name=? COLLATE BINARY",
        params![kind, name],
    )?
    .is_null()
    {
        Err("Choose a valid category.".into())
    } else {
        Ok(())
    }
}
pub(super) const EXPENSE: &[&str] = &[
    "Food & dining",
    "Groceries",
    "Transport",
    "Shopping",
    "Home & bills",
    "Health",
    "Entertainment",
    "Travel",
    "Other",
];
pub(super) const INCOME: &[&str] = &["Salary", "Freelance", "Interest", "Gifts", "Other"];
pub(super) fn seed(c: &Connection) -> R<()> {
    for (kind, names) in [("expense", EXPENSE), ("income", INCOME)] {
        for (i, name) in names.iter().enumerate() {
            exec(
                c,
                "INSERT OR IGNORE INTO categories(id,kind,name) VALUES (?,?,?)",
                params![format!("{kind}-{i}"), kind, name],
            )?;
        }
    }
    Ok(())
}

/// Initializes a fresh ledger or attaches receipt storage to an already migrated ledger.
/// Legacy migrations belong to Storage and must run before this function.
pub(crate) fn initialize(conn: &Connection) -> R<()> {
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;").map_err(err)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    conn.execute_batch("SAVEPOINT finance_initialize").map_err(err)?;
    let result = (|| {
        if !exists {
            conn.execute_batch(include_str!("../schema.sql")).map_err(err)?;
        }
        conn.execute_batch("CREATE TABLE IF NOT EXISTS receipt_files (id TEXT PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE, bytes BLOB NOT NULL CHECK(typeof(bytes)='blob')); CREATE INDEX IF NOT EXISTS transactions_month ON transactions(date,kind); CREATE INDEX IF NOT EXISTS transactions_account ON transactions(account_id); CREATE INDEX IF NOT EXISTS transactions_destination ON transactions(destination_account_id);").map_err(err)?;
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("RELEASE finance_initialize").map_err(err),
        Err(e) => {
            let _ =
                conn.execute_batch("ROLLBACK TO finance_initialize; RELEASE finance_initialize");
            Err(e)
        }
    }
}

pub(super) fn message(s: &str) -> Value {
    json!({"message":s})
}
pub(super) type NativeState<'a> = tauri::State<'a, std::sync::Mutex<crate::storage::Storage>>;
pub(super) fn locked<'a>(
    state: &'a NativeState<'_>,
) -> R<std::sync::MutexGuard<'a, crate::storage::Storage>> {
    state.lock().map_err(|_| "Storage is unavailable. Restart Folio.".to_owned())
}
/// Validation and writes share an immediate transaction; any error rolls back.
pub(super) fn transaction(
    conn: &mut Connection,
    form: &Value,
    operation: impl FnOnce(&Connection, &Value) -> R<Value>,
) -> R<Value> {
    if !form.is_object() {
        return Err("Expected a JSON form object.".into());
    }
    let tx =
        conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
    let result = operation(&tx, form)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
