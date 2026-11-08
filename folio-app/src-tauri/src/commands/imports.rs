use super::{files, ledger::*, shared::*};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
const HEADERS: [&str; 8] =
    ["date", "kind", "description", "amount", "account", "destination", "category", "notes"];
fn fingerprint(v: &Value) -> R<String> {
    let bytes = serde_json::to_vec(&json!([
        v["date"],
        v["kind"],
        v["amount"],
        field(v, "description").trim().to_lowercase(),
        v["account_id"],
        v["destination_account_id"],
        v["category"],
        v["notes"]
    ]))
    .map_err(err)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
fn preview(c: &Connection, s: &str) -> R<Vec<Value>> {

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(s.trim_start_matches('\u{feff}').as_bytes());
    let headers = reader.headers().map_err(err)?.clone();
    if !HEADERS.iter().all(|k| headers.iter().any(|h| h == *k)) {
        return Err(format!("Required headers: {}", HEADERS.join(",")));
    }
    let rows = reader.records().collect::<Result<Vec<_>, _>>().map_err(err)?;
    if rows.is_empty() || rows.len() > 1000 {
        return Err("Import between 1 and 1,000 rows at a time.".into());
    }
    let accounts = query(c, "SELECT id,name FROM accounts", [])?;
    let mut seen = HashSet::new();
    for v in query(c, "SELECT * FROM transactions", [])? {
        seen.insert(fingerprint(&v)?);
    }
    let mut out = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        if row.iter().map(str::len).sum::<usize>() > 10000 {
            return Err("CSV record exceeds 10,000 characters.".into());
        }
        let get = |key: &str| {
            headers.iter().position(|h| h == key).and_then(|i| row.get(i)).unwrap_or("")
        };
        let parsed = (|| {
            let mut f = Map::new();
            for k in ["date", "kind", "description", "amount", "category", "notes"] {
                f.insert(k.into(), json!(get(k)));
            }
            for (csv_key, form_key, error) in [
                ("account", "account_id", "Account name must match exactly one account."),
                (
                    "destination",
                    "destination_account_id",
                    "Destination must match exactly one account.",
                ),
            ] {
                if csv_key == "destination" && get("kind") != "transfer" {
                    continue;
                }
                let matching: Vec<_> =
                    accounts.iter().filter(|w| field(w, "name") == get(csv_key)).collect();
                if matching.len() != 1 {
                    return Err(error.to_string());
                }
                f.insert(form_key.into(), matching[0]["id"].clone());
            }
            parse_transaction(c, &Value::Object(f))
        })();
        out.push(match parsed{Ok(v)=>{let duplicate=!seen.insert(fingerprint(&v)?);json!({"line":index+2,"description":get("description"),"duplicate":duplicate,"value":v})},Err(e)=>json!({"line":index+2,"description":get("description"),"duplicate":false,"error":e})});
    }
    Ok(out)
}
pub(super) fn import(c: &Connection, f: &Value, preview_only: bool) -> R<Value> {
    let csv = if let Some((b, _)) = files::upload(f, "file", usize::MAX)? {
        String::from_utf8_lossy(&b).into_owned()
    } else {
        field(f, "csv").to_string()
    };
    if preview_only {
        return Ok(
            json!({"preview":preview(c,&csv)?,"csv":csv,"message":"Preview only. No transactions have been saved."}),
        );
    }
    let policy = text(f, "policy", 200)?;
    if !["skip", "reject"].contains(&policy.as_str()) {
        return Err("Choose a duplicate policy.".into());
    }
    let rows = preview(c, &csv)?;
    if rows.iter().any(|r| r.get("error").is_some()) {
        return Err("Fix all invalid rows before importing.".into());
    }
    if policy == "reject" && rows.iter().any(|r| r["duplicate"] == true) {
        return Err("Duplicates found. Choose skip duplicates or edit the CSV.".into());
    }
    let mut imported = 0;
    for r in &rows {
        if r["duplicate"] == true {
            continue;
        }
        write_transaction(c, &r["value"], false)?;
        imported += 1;
    }
    Ok(
        json!({"message":format!("Imported {imported} transactions; skipped {} duplicates.",rows.len()-imported)}),
    )
}
fn cell(s: &str) -> String {
    let trimmed = s.trim_start();
    let protected =
        if trimmed.starts_with(['=', '+', '@', '-']) { format!("'{s}") } else { s.to_string() };
    format!("\"{}\"", protected.replace('"', "\"\""))
}
/// Exports all transactions, billing due subscriptions first, as in the legacy export.
/// A savepoint supports both standalone callers and callers already in a transaction.
pub(super) fn write_csv(conn: &Connection) -> R<String> {
    conn.execute_batch("SAVEPOINT finance_export").map_err(err)?;
    let result = (|| {
        deduct(conn, &today())?;
        let rows = query(
            conn,
            "SELECT e.*,w.name account,d.name destination FROM transactions e JOIN accounts w ON w.id=e.account_id LEFT JOIN accounts d ON d.id=e.destination_account_id ORDER BY e.date,e.id",
            [],
        )?;
        let mut s = HEADERS.join(",") + "\r\n";
        for row in rows {
            let amount = decimal(row["amount"].as_i64().ok_or("Invalid amount.")?);
            let cells = HEADERS
                .iter()
                .map(|k| cell(if *k == "amount" { &amount } else { field(&row, k) }))
                .collect::<Vec<_>>();
            s.push_str(&cells.join(","));
            s.push_str("\r\n");
        }
        Ok(s)
    })();
    match result {
        Ok(s) => {
            conn.execute_batch("RELEASE finance_export").map_err(err)?;
            Ok(s)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK TO finance_export; RELEASE finance_export");
            Err(e)
        }
    }
}

pub(super) fn preview_import_operation(c: &Connection, f: &Value) -> R<Value> {
    import(c, f, true)
}

#[tauri::command]
pub fn preview_import(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, preview_import_operation)
}

pub(super) fn commit_import_operation(c: &Connection, f: &Value) -> R<Value> {
    import(c, f, false)
}

#[tauri::command]
pub fn commit_import(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, commit_import_operation)
}

#[tauri::command]
pub fn export_csv(state: NativeState<'_>) -> R<String> {
    let storage = locked(&state)?;
    write_csv(&storage.connection()?)
}
#[tauri::command]
pub fn import_legacy(state: NativeState<'_>, source: String, confirmation: String) -> R<Value> {
    if confirmation != "IMPORT" {
        return Err("Type IMPORT to copy your old storage.".into());
    }
    locked(&state)?.import_legacy(&source)?;
    Ok(json!({"message":"Existing storage copied. The original files were not changed."}))
}
