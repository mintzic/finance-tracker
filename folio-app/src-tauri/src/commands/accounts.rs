use super::{ledger::balances, shared::*};
pub(super) fn save_account_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    let name = text(f, "name", 80)?;
    let opening = minor(&text(f, "opening", 200)?)?;
    if id.is_empty() {
        exec(
            c,
            "INSERT INTO accounts(id,name,opening) VALUES (?,?,?)",
            params![uid(), name, opening],
        )?;
    } else {
        record(c, "accounts", id)?;
        exec(
            c,
            "UPDATE accounts SET name=?,opening=?,archived=? WHERE id=?",
            params![name, opening, if field(f, "archived") == "on" { 1 } else { 0 }, id],
        )?;
    }
    Ok(message("Account saved. Balances recalculated."))
}
#[tauri::command]
pub fn save_account(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_account_operation)
}
pub(super) fn adjust_account_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    let w = balances(c, "9999-12-31")?
        .into_iter()
        .find(|w| field(w, "id") == id)
        .ok_or("Account not found.")?;
    let target = minor(&text(f, "balance", 200)?)?;
    let opening = w["opening"]
        .as_i64()
        .ok_or("Invalid opening balance.")?
        .checked_add(target)
        .and_then(|n| n.checked_sub(w["balance"].as_i64()?))
        .ok_or("Adjusted opening balance is too large.")?;
    if !(-MAX..=MAX).contains(&opening) {
        return Err("Adjusted opening balance is too large.".into());
    }
    exec(c, "UPDATE accounts SET opening=? WHERE id=?", params![opening, id])?;
    Ok(message("Balance adjusted. Income and spending are unchanged."))
}
#[tauri::command]
pub fn adjust_account(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, adjust_account_operation)
}
pub(super) fn delete_account_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    record(c, "accounts", id)?;
    if field(f, "policy") == "keep" {
        exec(c, "UPDATE accounts SET archived=1 WHERE id=?", [id])?;
        return Ok(message("Account archived. Transactions and reports preserved."));
    }
    if field(f, "policy") != "delete" || field(f, "confirmation") != "DELETE" {
        return Err("Type DELETE to remove the account and its transactions.".into());
    }
    exec(c, "DELETE FROM subscriptions WHERE account_id=?", [id])?;
    exec(c, "DELETE FROM transactions WHERE account_id=?1 OR destination_account_id=?1", [id])?;
    exec(c, "DELETE FROM accounts WHERE id=?", [id])?;
    Ok(message(
        "Account and linked transactions, transfers, receipts, and subscriptions deleted. Balances recalculated.",
    ))
}
#[tauri::command]
pub fn delete_account(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, delete_account_operation)
}
