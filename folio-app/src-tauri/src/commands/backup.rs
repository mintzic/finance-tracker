use super::shared::*;

#[tauri::command]
pub fn export_backup(state: NativeState<'_>) -> R<Value> {
    locked(&state)?.export_backup()
}
#[tauri::command]
pub fn restore_backup(state: NativeState<'_>, backup: Value, confirmation: String) -> R<Value> {
    locked(&state)?.restore_backup(backup, &confirmation)
}

pub(super) fn table_csv(c: &Connection, table: &str) -> R<String> {
    if ![
        "transactions",
        "accounts",
        "categories",
        "budgets",
        "subscriptions",
        "goals",
        "contributions",
    ]
    .contains(&table)
    {
        return Err("Unsupported export table.".into());
    }
    let mut statement = c.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).map_err(err)?;
    let names = statement.column_names().map(|s| s.to_string()).collect::<Vec<_>>();
    let mut writer =
        csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(Vec::new());
    writer.write_record(&names).map_err(err)?;
    let mut rows = statement.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let mut record = Vec::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i).map_err(err)? {
                ValueRef::Null => String::new(),
                ValueRef::Integer(n) if ["amount", "opening"].contains(&name.as_str()) => {
                    decimal(n)
                }
                ValueRef::Integer(n) => n.to_string(),
                ValueRef::Real(n) => n.to_string(),
                ValueRef::Text(bytes) => {
                    let text = String::from_utf8_lossy(bytes).into_owned();
                    // Excel formula injection protection, including leading whitespace/control characters.
                    if text.trim_start().starts_with(['=', '+', '-', '@'])
                        || text.starts_with(['\t', '\r', '\n'])
                    {
                        format!("'{text}")
                    } else {
                        text
                    }
                }
                ValueRef::Blob(_) => {
                    return Err("Unexpected binary column in viewing export.".into());
                }
            };
            record.push(value);
        }
        writer.write_record(record).map_err(err)?;
    }
    let bytes = writer.into_inner().map_err(err)?;
    Ok(format!("\u{feff}{}", String::from_utf8(bytes).map_err(err)?))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn viewing_csv_allowlist_money_escaping_and_formula_safety() {
        let c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        c.execute(
            "INSERT INTO accounts(id,name,opening) VALUES ('a',?,12345)",
            [" =HYPERLINK(\"evil\"),\n雪"],
        )
        .unwrap();
        let output = table_csv(&c, "accounts").unwrap();
        assert!(output.starts_with('\u{feff}'));
        let mut reader = csv::Reader::from_reader(output.trim_start_matches('\u{feff}').as_bytes());
        let row = reader.records().next().unwrap().unwrap();
        assert_eq!(&row[1], "' =HYPERLINK(\"evil\"),\n雪");
        assert_eq!(&row[2], "123.45");
        for table in
            ["transactions", "categories", "budgets", "subscriptions", "goals", "contributions"]
        {
            assert!(table_csv(&c, table).is_ok());
        }
        for table in ["receipts", "accounts; DROP TABLE accounts", "sqlite_schema", "Accounts"] {
            assert!(table_csv(&c, table).is_err());
        }
    }
}

#[tauri::command]
pub fn export_table_csv(state: NativeState<'_>, table: String) -> R<String> {
    let storage = locked(&state)?;
    table_csv(&storage.connection()?, &table)
}
