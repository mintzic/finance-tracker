use super::shared::*;
pub(super) fn save_subscription_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    let account = text(f, "account_id", 200)?;
    let w = record(c, "accounts", &account)?;
    if !id.is_empty() {
        record(c, "subscriptions", id)?;
    }
    if w["archived"] == 1 {
        return Err("Choose an active account.".into());
    }
    let recurrence = text(f, "recurrence", 200)?;
    let status = text(f, "status", 200)?;
    if !["weekly", "monthly", "yearly"].contains(&recurrence.as_str())
        || !["active", "paused", "cancelled"].contains(&status.as_str())
    {
        return Err("Invalid subscription settings.".into());
    }
    let name = text(f, "name", 80)?;
    let amount = positive(f)?;
    let cat = text(f, "category", 200)?;
    category(c, "expense", &cat)?;
    let due = text(f, "next_due", 200)?;
    date(&due)?;
    if id.is_empty() {
        exec(
            c,
            "INSERT INTO subscriptions(id,name,amount,category,account_id,recurrence,next_due,status) VALUES (?,?,?,?,?,?,?,?)",
            params![uid(), name, amount, cat, account, recurrence, due, status],
        )?;
    } else {
        exec(
            c,
            "UPDATE subscriptions SET billing_anchor=CASE WHEN next_due<>? OR recurrence<>? THEN ? ELSE billing_anchor END,name=?,amount=?,category=?,account_id=?,recurrence=?,next_due=?,status=? WHERE id=?",
            params![due, recurrence, due, name, amount, cat, account, recurrence, due, status, id],
        )?;
    }
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn save_subscription(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_subscription_operation)
}
