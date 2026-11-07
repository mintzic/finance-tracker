use super::files::read_asset as asset;
use super::imports::write_csv as export_csv;
use super::overview::read_dashboard as dashboard;
use super::{ledger::*, shared::*, *};

fn cover_image(width: u32, height: u32, alpha: bool) -> Vec<u8> {
    let image = if alpha {
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([30, 80, 120, 100]),
        ))
    } else {
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            width,
            height,
            image::Rgb([30, 80, 120]),
        ))
    };
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

#[test]
fn cover_optimization_formats_dimensions_and_large_input() {
    use image::GenericImageView;
    for (width, height, alpha, expected) in [
        (3000, 1500, false, (2560, 1280)),
        (1000, 2000, true, (720, 1440)),
        (2, 3, false, (2, 3)),
    ] {
        let (bytes, mime) = files::optimize_cover(&cover_image(width, height, alpha)).unwrap();
        assert_eq!(mime, if alpha { "image/png" } else { "image/jpeg" });
        let image = image::load_from_memory(&bytes).unwrap();
        assert_eq!(image.dimensions(), expected);
        assert_eq!(image.color().has_alpha(), alpha);
        if alpha {
            assert_eq!(image.to_rgba8().get_pixel(0, 0).0[3], 100);
        }
    }
    // Valid PNG with trailing padding: no compressed-byte cap, including >100 MiB.
    let mut large = cover_image(2, 2, false);
    large.resize(101 * 1024 * 1024, 0);
    let (bytes, _) = files::optimize_cover(&large).unwrap();
    assert!(bytes.len() < 1024);
    large.truncate(6 * 1024 * 1024);
    let mut c = db();
    transaction(
        &mut c,
        &json!({"cover":{"bytes":large}}),
        files::upload_cover_operation,
    )
    .unwrap();

    for format in [image::ImageFormat::Jpeg, image::ImageFormat::WebP] {
        let image = image::load_from_memory(&cover_image(2, 2, false)).unwrap();
        let mut input = std::io::Cursor::new(Vec::new());
        image.write_to(&mut input, format).unwrap();
        let (bytes, _) = files::optimize_cover(input.get_ref()).unwrap();
        assert_eq!(
            image::load_from_memory(&bytes).unwrap().dimensions(),
            (2, 2)
        );
    }
}

#[test]
fn cover_invalid_dimensions_and_replacement_rollback() {
    let mut c = db();
    let form = json!({"cover":{"bytes":cover_image(2, 2, true)}});
    transaction(&mut c, &form, files::upload_cover_operation).unwrap();
    let previous = one(&c, "SELECT * FROM workspace_cover", []).unwrap();
    for bytes in [b"not an image".to_vec(), b"\x89PNG\r\n\x1a\n".to_vec(), {
        let mut bytes = cover_image(2, 2, false);
        bytes.truncate(bytes.len() / 2);
        bytes
    }] {
        assert!(
            transaction(
                &mut c,
                &json!({"cover":{"bytes":bytes}}),
                files::upload_cover_operation
            )
            .is_err()
        );
        assert_eq!(
            one(&c, "SELECT * FROM workspace_cover", []).unwrap(),
            previous
        );
    }
    // Generate valid PNG IHDR checksums without allocating the claimed image.
    for (width, height) in [(32769u32, 1u32), (10001, 10000)] {
        let mut bytes = cover_image(2, 2, false);
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let mut crc = !0u32;
        for byte in &bytes[12..29] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1));
            }
        }
        bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
        let error = files::optimize_cover(&bytes).unwrap_err();
        assert!(
            error.contains("limit") || error.contains("100 million"),
            "{error}"
        );
    }
    c.execute_batch("CREATE TRIGGER fail_cover BEFORE UPDATE ON workspace_cover BEGIN SELECT RAISE(ABORT, 'cover failure'); END;").unwrap();
    assert!(transaction(&mut c, &form, files::upload_cover_operation).is_err());
    assert_eq!(
        one(&c, "SELECT * FROM workspace_cover", []).unwrap(),
        previous
    );
}

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    initialize(&c).unwrap();
    c.execute_batch(
        "INSERT INTO wallets(id,name,opening) VALUES ('a','Everyday',10000),('b','Savings',20000)",
    )
    .unwrap();
    c
}
fn entry() -> Value {
    json!({"intent":"entry","kind":"expense","date":"2026-10-01","description":"Coffee","amount":"5.50","wallet_id":"a","category":"Food & dining"})
}
fn count(c: &Connection, table: &str) -> i64 {
    c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn id(c: &Connection, table: &str) -> String {
    c.query_row(&format!("SELECT id FROM {table} LIMIT 1"), [], |r| r.get(0))
        .unwrap()
}
fn bill(c: &mut Connection, through: &str) -> R<usize> {
    let tx = c.transaction().map_err(err)?;
    let n = deduct(&tx, through)?;
    tx.commit().map_err(err)?;
    Ok(n)
}
#[test]
fn initialization_is_idempotent() {
    let c = db();
    initialize(&c).unwrap();
    assert_eq!(count(&c, "categories"), 14);
    assert_eq!(count(&c, "wallets"), 2);
}
#[test]
fn money_and_dates() {
    assert_eq!(minor("12.5").unwrap(), 1250);
    assert_eq!(minor("-0.01").unwrap(), -1);
    assert_eq!(minor("0.10").unwrap() + minor("0.20").unwrap(), 30);
    for s in [
        "1.001",
        "1e2",
        "NaN",
        "Infinity",
        "1,000.00",
        "",
        "+1",
        "1.",
        "99999999999",
    ] {
        assert!(minor(s).is_err(), "{s}");
    }
    assert!(date("2024-02-29").is_ok());
    for s in ["2026-02-29", "2026-04-31", "2026-2-01", "1899-01-01"] {
        assert!(date(s).is_err());
    }
    assert_eq!(
        month_range("2026-12").unwrap(),
        ("2026-12-01".into(), "2027-01-01".into())
    );
    assert!(month_range("9999-01").is_err());
}
#[test]
fn transfers_edit_delete_and_summary() {
    let mut c = db();
    let mut f = entry();
    f["kind"] = json!("transfer");
    f["destination_id"] = json!("b");
    f["amount"] = json!("30.00");
    mutate(&mut c, &f).unwrap();
    assert_eq!(balances(&c, "9999-12-31").unwrap()[0]["balance"], 7000);
    assert_eq!(balances(&c, "9999-12-31").unwrap()[1]["balance"], 23000);
    let d = dashboard(&mut c, &json!({"month":"2026-10"})).unwrap();
    assert_eq!(d["sum"], json!({"income":0,"expense":0}));
    f["id"] = json!(id(&c, "entries"));
    f["amount"] = json!("20.00");
    mutate(&mut c, &f).unwrap();
    assert_eq!(balances(&c, "9999-12-31").unwrap()[0]["balance"], 8000);
    mutate(&mut c, &json!({"intent":"delete_entry","id":f["id"]})).unwrap();
    assert_eq!(balances(&c, "9999-12-31").unwrap()[0]["balance"], 10000);
}
#[test]
fn invalid_entries_are_atomic() {
    let mut c = db();
    for patch in [
        json!({"amount":"1.001"}),
        json!({"date":"2026-02-29"}),
        json!({"category":"Unknown"}),
        json!({"kind":"transfer","destination_id":"a"}),
        json!({"kind":"transfer","destination_id":"missing"}),
    ] {
        let mut f = entry();
        for (k, v) in patch.as_object().unwrap() {
            f[k] = v.clone();
        }
        assert!(mutate(&mut c, &f).is_err());
    }
    assert_eq!(count(&c, "entries"), 0);
}
#[test]
fn archived_account_edits() {
    let mut c = db();
    mutate(&mut c, &entry()).unwrap();
    let mut f = entry();
    f["id"] = json!(id(&c, "entries"));
    c.execute_batch("UPDATE wallets SET archived=1 WHERE id='a'")
        .unwrap();
    mutate(&mut c, &f).unwrap();
    assert!(mutate(&mut c, &entry()).is_err());
}
#[test]
fn month_boundaries_and_allocations() {
    let mut c = db();
    let mut f = entry();
    f["date"] = json!("2024-02-29");
    mutate(&mut c, &f).unwrap();
    f["date"] = json!("2024-03-01");
    mutate(&mut c, &f).unwrap();
    c.execute_batch("INSERT INTO goals VALUES ('g','Trip',100000,'2027-01-01'); INSERT INTO contributions VALUES ('x','g',5000,'2024-02-01')").unwrap();
    let d = dashboard(&mut c, &json!({"month":"2024-02"})).unwrap();
    assert_eq!(d["sum"]["expense"], 550);
    assert_eq!(d["monthBalances"][0]["balance"], 9450);
    assert_eq!(d["wallets"][0]["balance"], 8900);
    assert_eq!(d["goals"][0]["saved"], 5000);
    assert_eq!(d["trends"].as_array().unwrap().len(), 6);
    assert!(d.get("edit").is_none());
}
#[test]
fn budget_series_and_override() {
    let mut c = db();
    let mut f = json!({"intent":"budget","month":"2026-10","category":"Entertainment","amount":"200","all_months":"on"});
    mutate(&mut c, &f).unwrap();
    let recurring = id(&c, "budgets");
    f["month"] = json!("2026-12");
    f["amount"] = json!("150");
    f["all_months"] = json!("");
    mutate(&mut c, &f).unwrap();
    for (month, n) in [("2026-11", 20000), ("2026-12", 15000), ("2027-01", 20000)] {
        assert_eq!(
            dashboard(&mut c, &json!({"month":month})).unwrap()["budgets"][0]["amount"],
            n
        );
    }
    f["id"] = json!(recurring);
    f["month"] = json!("2026-10");
    mutate(&mut c, &f).unwrap();
    assert_eq!(
        record(&c, "budgets", &recurring).unwrap()["month"],
        "2026-11"
    );
}
#[test]
fn categories_propagate_and_merge() {
    let mut c = db();
    mutate(&mut c, &entry()).unwrap();
    c.execute_batch("INSERT INTO budgets(id,month,category,amount) VALUES ('x','2026-10','Food & dining',5000),('y','2026-10','Other',1000)").unwrap();
    mutate(
        &mut c,
        &json!({"intent":"category","id":"expense-0","name":"Dining"}),
    )
    .unwrap();
    assert_eq!(
        record(&c, "entries", &id(&c, "entries")).unwrap()["category"],
        "Dining"
    );
    mutate(
        &mut c,
        &json!({"intent":"delete_category","id":"expense-0"}),
    )
    .unwrap();
    assert_eq!(count(&c, "budgets"), 1);
    assert_eq!(record(&c, "budgets", "y").unwrap()["amount"], 6000);
    assert!(
        mutate(
            &mut c,
            &json!({"intent":"delete_category","id":"expense-8"})
        )
        .is_err()
    );
    assert!(
        mutate(
            &mut c,
            &json!({"intent":"category","kind":"expense","name":"other"})
        )
        .is_err()
    );
}
#[test]
fn category_overflow_rolls_back() {
    let mut c = db();
    mutate(&mut c, &entry()).unwrap();
    c.execute_batch("INSERT INTO budgets(id,month,category,amount) VALUES ('x','2026-10','Food & dining',999999999999),('y','2026-10','Other',1)").unwrap();
    assert!(
        mutate(
            &mut c,
            &json!({"intent":"delete_category","id":"expense-0"})
        )
        .is_err()
    );
    assert_eq!(
        record(&c, "entries", &id(&c, "entries")).unwrap()["category"],
        "Food & dining"
    );
    assert_eq!(count(&c, "budgets"), 2);
}
#[test]
fn subscription_calendar() {
    for (due, rec, anchor, next) in [
        ("2026-12-28", "weekly", "2026-12-28", "2027-01-04"),
        ("2025-01-31", "monthly", "2025-01-31", "2025-02-28"),
        ("2025-02-28", "monthly", "2025-01-31", "2025-03-31"),
        ("2027-02-28", "yearly", "2024-02-29", "2028-02-29"),
    ] {
        assert_eq!(next_billing(due, rec, anchor).unwrap(), next);
    }
}
#[test]
fn subscription_history_prevents_rebilling() {
    let mut c = db();
    c.execute_batch("INSERT INTO subscriptions(id,name,amount,category,wallet_id,recurrence,next_due,status) VALUES ('s','Music',1000,'Entertainment','a','monthly','2024-01-31','active')").unwrap();
    assert_eq!(bill(&mut c, "2024-03-31").unwrap(), 3);
    assert_eq!(bill(&mut c, "2024-03-31").unwrap(), 0);
    assert_eq!(
        query(&c, "SELECT date FROM entries ORDER BY date", []).unwrap(),
        vec![
            json!({"date":"2024-01-31"}),
            json!({"date":"2024-02-29"}),
            json!({"date":"2024-03-31"})
        ]
    );
    c.execute_batch("DELETE FROM entries;UPDATE subscriptions SET next_due='2024-01-31'")
        .unwrap();
    assert_eq!(bill(&mut c, "2024-03-31").unwrap(), 0);
    assert_eq!(count(&c, "entries"), 0);
}
#[test]
fn billing_failure_rolls_back() {
    let mut c = db();
    c.execute_batch("INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES ('s','Music',1000,'a','weekly','2026-10-01','active');CREATE TRIGGER fail_charge BEFORE INSERT ON subscription_charges BEGIN SELECT RAISE(ABORT,'test failure');END;").unwrap();
    assert!(bill(&mut c, "2026-10-15").is_err());
    assert_eq!(count(&c, "entries"), 0);
    assert_eq!(
        record(&c, "subscriptions", "s").unwrap()["next_due"],
        "2026-10-01"
    );
}
#[test]
fn receipt_storage_replacement_cleanup_and_validation() {
    let mut c = db();
    let mut f = entry();
    f["receipt"] =
        json!({"name":"../../invoice\r\n.pdf","mime":"text/html","bytes":b"%PDF-test".to_vec()});
    mutate(&mut c, &f).unwrap();
    let rid = id(&c, "receipts");
    let a = asset(&c, "receipt", &rid).unwrap();
    assert_eq!(a["mime"], "application/pdf");
    assert_eq!(a["bytes"], json!(b"%PDF-test".to_vec()));
    assert!(!field(&a, "filename").contains('/'));
    f["id"] = json!(id(&c, "entries"));
    f["receipt"] = json!({"name":"bad.pdf","bytes":[256]});
    assert!(mutate(&mut c, &f).is_err());
    assert!(asset(&c, "receipt", &rid).is_ok());
    f["receipt"] = Value::Null;
    f["remove_receipt"] = json!("on");
    mutate(&mut c, &f).unwrap();
    assert_eq!(count(&c, "native_files"), 0);
    f["receipt"] = json!({"bytes":b"%PDF-test".to_vec()});
    mutate(&mut c, &f).unwrap();
    mutate(
        &mut c,
        &json!({"intent":"delete_wallet","id":"a","policy":"delete","confirmation":"DELETE"}),
    )
    .unwrap();
    assert_eq!(count(&c, "native_files"), 0);
    assert_eq!(count(&c, "receipts"), 0);
}
#[test]
fn cover_version_and_sniffing() {
    let mut c = db();
    let f = json!({"intent":"upload_cover","cover":{"name":"x.png","mime":"image/png","bytes":cover_image(2, 2, true)}});
    mutate(&mut c, &f).unwrap();
    let v = one(&c, "SELECT version FROM workspace_cover", []).unwrap()["version"].clone();
    mutate(
        &mut c,
        &json!({"intent":"position_cover","position":"72.5","version":v}),
    )
    .unwrap();
    assert!(
        mutate(
            &mut c,
            &json!({"intent":"position_cover","position":"20","version":"stale"})
        )
        .is_err()
    );
    let mut bad = f.clone();
    bad["cover"]["bytes"] = json!([60, 115, 118, 103, 62]);
    assert!(mutate(&mut c, &bad).is_err());
    assert!(asset(&c, "cover", v.as_str().unwrap()).is_ok());
    mutate(&mut c, &f).unwrap();
    assert!(asset(&c, "cover", v.as_str().unwrap()).is_err());
    mutate(&mut c, &json!({"intent":"remove_cover"})).unwrap();
    assert!(asset(&c, "cover", "1").is_err());
}
const CSV: &str = "date,kind,description,amount,account,destination,category,notes\n2026-10-01,expense,Coffee,5.50,Everyday,,Food & dining,\n";
#[test]
fn csv_preview_duplicate_and_atomic_commit() {
    let mut c = db();
    let mut f = json!({"intent":"preview_import","csv":CSV});
    let p = mutate(&mut c, &f).unwrap();
    assert_eq!(p["preview"][0]["duplicate"], false);
    assert_eq!(count(&c, "entries"), 0);
    f["intent"] = json!("commit_import");
    f["policy"] = json!("skip");
    mutate(&mut c, &f).unwrap();
    mutate(&mut c, &f).unwrap();
    assert_eq!(count(&c, "entries"), 1);
    f["policy"] = json!("reject");
    assert!(mutate(&mut c, &f).is_err());
    c.execute_batch("DELETE FROM entries").unwrap();
    mutate(&mut c, &entry()).unwrap();
    f["intent"] = json!("preview_import");
    assert_eq!(mutate(&mut c, &f).unwrap()["preview"][0]["duplicate"], true);
    f["intent"] = json!("commit_import");
    f["policy"] = json!("skip");
    f["csv"] = json!(format!(
        "{CSV}2026-10-02,expense,Bad,1.001,Everyday,,Food & dining,\n"
    ));
    assert!(mutate(&mut c, &f).is_err());
    assert_eq!(count(&c, "entries"), 1);
}
#[test]
fn export_quotes_and_formula_protection() {
    let mut c = db();
    let mut f = entry();
    f["description"] = json!(" =SUM(A1)");
    f["notes"] = json!("A, \"quote\"\nand newline");
    mutate(&mut c, &f).unwrap();
    let s = export_csv(&c).unwrap();
    assert!(s.contains("\"'=SUM(A1)\""));
    assert!(s.contains("A, \"\"quote\"\"\nand newline"));
    assert!(s.starts_with("date,kind,description,amount,account,destination,category,notes\r\n"));
}
#[test]
fn dashboard_pagination_filter_and_edit() {
    let mut c = db();
    for i in 0..25 {
        let mut f = entry();
        f["description"] = json!(format!("Coffee {i}"));
        mutate(&mut c, &f).unwrap();
    }
    let eid = id(&c, "entries");
    let d=dashboard(&mut c,&json!({"month":"2026-10","view":"expenses","page":"999","sort":"amount","dir":"asc","edit":eid})).unwrap();
    assert_eq!(d["page"], 2);
    assert_eq!(d["count"], 25);
    assert_eq!(d["transactions"].as_array().unwrap().len(), 5);
    assert_eq!(d["recentExpenses"].as_array().unwrap().len(), 5);
    assert_eq!(d["edit"]["id"], eid);
    let d = dashboard(&mut c, &json!({"month":"2026-10","q":"Coffee 24"})).unwrap();
    assert_eq!(d["count"], 1);
    assert!(dashboard(&mut c, &json!({"view":"invalid"})).is_err());
}
#[test]
fn reset_and_demo() {
    let mut c = Connection::open_in_memory().unwrap();
    initialize(&c).unwrap();
    mutate(&mut c, &json!({"intent":"demo"})).unwrap();
    assert_eq!(count(&c, "entries"), 8);
    assert_eq!(count(&c, "wallets"), 3);
    assert!(mutate(&mut c, &json!({"intent":"demo"})).is_err());
    assert!(mutate(&mut c, &json!({"intent":"reset","confirmation":"wrong"})).is_err());
    mutate(&mut c, &json!({"intent":"reset","confirmation":"RESET"})).unwrap();
    assert_eq!(count(&c, "entries"), 0);
    assert_eq!(count(&c, "categories"), 14);
}

// Compatibility adapter only for existing behavioral fixtures.
fn mutate(c: &mut Connection, f: &Value) -> R<Value> {
    let operation = match field(f, "intent") {
        "wallet" => accounts::save_account_operation as fn(&Connection, &Value) -> R<Value>,
        "adjust_wallet" => {
            accounts::adjust_account_operation as fn(&Connection, &Value) -> R<Value>
        }
        "delete_wallet" => {
            accounts::delete_account_operation as fn(&Connection, &Value) -> R<Value>
        }
        "entry" => transactions::save_transaction_operation as fn(&Connection, &Value) -> R<Value>,
        "delete_entry" => {
            transactions::delete_transaction_operation as fn(&Connection, &Value) -> R<Value>
        }
        "budget" => budgets::save_budget_operation as fn(&Connection, &Value) -> R<Value>,
        "delete_budget" => budgets::delete_budget_operation as fn(&Connection, &Value) -> R<Value>,
        "category" => categories::save_category_operation as fn(&Connection, &Value) -> R<Value>,
        "delete_category" => {
            categories::delete_category_operation as fn(&Connection, &Value) -> R<Value>
        }
        "subscription" => {
            subscriptions::save_subscription_operation as fn(&Connection, &Value) -> R<Value>
        }
        "goal" => goals::save_goal_operation as fn(&Connection, &Value) -> R<Value>,
        "contribute" => goals::add_contribution_operation as fn(&Connection, &Value) -> R<Value>,
        "delete_contribution" => {
            goals::delete_contribution_operation as fn(&Connection, &Value) -> R<Value>
        }
        "reset" => maintenance::reset_workspace_operation as fn(&Connection, &Value) -> R<Value>,
        "demo" => maintenance::seed_demo_operation as fn(&Connection, &Value) -> R<Value>,
        "upload_cover" => files::upload_cover_operation as fn(&Connection, &Value) -> R<Value>,
        "remove_cover" => files::remove_cover_operation as fn(&Connection, &Value) -> R<Value>,
        "position_cover" => files::position_cover_operation as fn(&Connection, &Value) -> R<Value>,
        "preview_import" => {
            imports::preview_import_operation as fn(&Connection, &Value) -> R<Value>
        }
        "commit_import" => imports::commit_import_operation as fn(&Connection, &Value) -> R<Value>,
        _ => return Err("Unknown action.".into()),
    };
    transaction(c, f, operation)
}

#[test]
fn fixed_feature_operations_ignore_supplied_intent() {
    let mut c = db();
    // These are the exact operation callbacks bound by the IPC commands.
    transaction(
        &mut c,
        &json!({"intent":"reset","name":"New account","opening":"12.34"}),
        accounts::save_account_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "wallets"), 3);
    transaction(
        &mut c,
        &json!({"intent":"delete_wallet","id":"a","balance":"200"}),
        accounts::adjust_account_operation,
    )
    .unwrap();
    assert_eq!(record(&c, "wallets", "a").unwrap()["opening"], 20000);
    let mut f = entry();
    f["intent"] = json!("reset");
    transaction(&mut c, &f, transactions::save_transaction_operation).unwrap();
    assert_eq!(count(&c, "entries"), 1);
    let entry_id = id(&c, "entries");
    transaction(
        &mut c,
        &json!({"id":entry_id,"intent":"entry"}),
        transactions::delete_transaction_operation,
    )
    .unwrap();
}

#[test]
fn fixed_cover_operations_cannot_be_redirected() {
    let mut c = db();
    let f = json!({"intent":"remove_cover","cover":{"bytes":cover_image(2, 2, false)}});
    transaction(&mut c, &f, files::upload_cover_operation).unwrap();
    let version = one(&c, "SELECT version FROM workspace_cover", []).unwrap()["version"].clone();
    transaction(
        &mut c,
        &json!({"intent":"remove_cover","position":"75","version":version}),
        files::position_cover_operation,
    )
    .unwrap();
    assert_eq!(
        one(&c, "SELECT position FROM workspace_cover", []).unwrap()["position"],
        75.0
    );
    transaction(
        &mut c,
        &json!({"intent":"upload_cover"}),
        files::remove_cover_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "workspace_cover"), 0);
}

#[test]
fn fixed_import_operations_cannot_be_redirected() {
    let mut c = db();
    let preview = transaction(
        &mut c,
        &json!({"intent":"commit_import","csv":CSV}),
        imports::preview_import_operation,
    )
    .unwrap();
    assert_eq!(preview["preview"][0]["duplicate"], false);
    assert_eq!(count(&c, "entries"), 0);
    transaction(
        &mut c,
        &json!({"intent":"preview_import","csv":CSV,"policy":"skip"}),
        imports::commit_import_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "entries"), 1);
    assert!(transaction(&mut c, &Value::Null, imports::preview_import_operation).is_err());
}

#[test]
fn fixed_operations_work_without_intent() {
    let mut c = db();
    let mut f = entry();
    f.as_object_mut().unwrap().remove("intent");
    transaction(&mut c, &f, transactions::save_transaction_operation).unwrap();
    transaction(
        &mut c,
        &json!({"month":"2026-10","category":"Entertainment","amount":"20"}),
        budgets::save_budget_operation,
    )
    .unwrap();
    transaction(
        &mut c,
        &json!({"kind":"expense","name":"Hobbies"}),
        categories::save_category_operation,
    )
    .unwrap();
    transaction(
        &mut c,
        &json!({"name":"Trip","amount":"100","target_date":"2027-01-01"}),
        goals::save_goal_operation,
    )
    .unwrap();
    let goal = id(&c, "goals");
    transaction(
        &mut c,
        &json!({"goal_id":goal,"amount":"10","date":"2026-10-01"}),
        goals::add_contribution_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "contributions"), 1);
    transaction(
        &mut c,
        &json!({"confirmation":"RESET","intent":"demo"}),
        maintenance::reset_workspace_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "wallets"), 0);
    transaction(
        &mut c,
        &json!({"intent":"reset","confirmation":"RESET"}),
        maintenance::seed_demo_operation,
    )
    .unwrap();
    assert_eq!(count(&c, "wallets"), 3);
}
