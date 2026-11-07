use super::{
    ledger::{parse_entry, write_entry},
    shared::*,
};
pub(super) fn reset_workspace_operation(c: &Connection, f: &Value) -> R<Value> {
    if field(f, "confirmation") != "RESET" {
        return Err("Type RESET to clear the workspace.".into());
    }
    for t in [
        "subscription_charges",
        "native_files",
        "receipts",
        "contributions",
        "goals",
        "subscriptions",
        "budgets",
        "entries",
        "wallets",
        "categories",
        "workspace_cover",
    ] {
        exec(c, &format!("DELETE FROM {t}"), [])?;
    }
    seed(c)?;
    Ok(message(
        "Workspace reset. All records and the cover were removed; default categories restored.",
    ))
}
#[tauri::command]
pub fn reset_workspace(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(
        &mut workspace.connection()?,
        &form,
        reset_workspace_operation,
    )
}
pub(super) fn seed_demo_operation(c: &Connection, _f: &Value) -> R<Value> {
    demo(c)?;
    Ok(message(
        "Fictional demo data added. All demo accounts and descriptions are labelled.",
    ))
}
#[tauri::command]
pub fn seed_demo(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(&mut workspace.connection()?, &form, seed_demo_operation)
}
fn demo(c: &Connection) -> R<()> {
    if !one(c, "SELECT id FROM wallets LIMIT 1", [])?.is_null() {
        return Err("Demo data is only available in an empty workspace.".into());
    }
    let main = uid();
    let savings = uid();
    let cash = uid();
    for (id, name, n) in [
        (&main, "Demo · Everyday", 125000),
        (&savings, "Demo · Savings", 600000),
        (&cash, "Demo · Wallet", 15000),
    ] {
        exec(
            c,
            "INSERT INTO wallets(id,name,opening) VALUES (?,?,?)",
            params![id, name, n],
        )?;
    }
    let now = today();
    let month = &now[..7];
    for (kind, cat, desc, amount, day) in [
        ("income", "Salary", "Fictional monthly salary", "4800.00", 1),
        ("expense", "Food & dining", "Demo · Little café", "18.50", 3),
        (
            "expense",
            "Groceries",
            "Demo · Weekly groceries",
            "96.40",
            5,
        ),
        ("expense", "Transport", "Demo · MRT top-up", "40.00", 8),
        ("expense", "Home & bills", "Demo · Internet", "49.90", 9),
        ("expense", "Shopping", "Demo · A good book", "32.00", 12),
        (
            "expense",
            "Food & dining",
            "Demo · Dinner with friends",
            "64.80",
            15,
        ),
        (
            "transfer",
            "Transfer",
            "Demo · Move to savings",
            "600.00",
            16,
        ),
    ] {
        let f = json!({"kind":kind,"category":cat,"description":desc,"amount":amount,"wallet_id":main,"destination_id":savings,"date":format!("{month}-{day:02}"),"notes":"Fictional demo data — not real financial records."});
        let v = parse_entry(c, &f)?;
        write_entry(c, &v, false)?;
    }
    for (cat, n) in [
        ("Food & dining", 50000),
        ("Groceries", 35000),
        ("Transport", 15000),
        ("Shopping", 20000),
    ] {
        exec(
            c,
            "INSERT INTO budgets(id,month,category,amount) VALUES (?,?,?,?)",
            params![uid(), month, cat, n],
        )?;
    }
    exec(
        c,
        "INSERT INTO subscriptions(id,name,amount,category,wallet_id,recurrence,next_due,status) VALUES (?,'Demo · Music',1098,'Entertainment',?,'monthly',?,'active')",
        params![uid(), main, format!("{month}-28")],
    )?;
    let goal = uid();
    let year = now[..4].parse::<i32>().map_err(err)?;
    exec(
        c,
        "INSERT INTO goals(id,name,amount,target_date) VALUES (?,'Demo · A little adventure',300000,?)",
        params![goal, format!("{}-06-01", year + 1)],
    )?;
    exec(
        c,
        "INSERT INTO contributions(id,goal_id,amount,date) VALUES (?,?,60000,?)",
        params![uid(), goal, format!("{month}-16")],
    )?;
    Ok(())
}
