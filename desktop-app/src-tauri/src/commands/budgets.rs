use super::shared::*;
pub(super) fn save_budget_operation(c: &Connection, f: &Value) -> R<Value> {
    write_budget(c, f)?;
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn save_budget(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_budget_operation)
}
pub(super) fn delete_budget_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    exec(c, "DELETE FROM budgets WHERE id=?", [id])?;
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn delete_budget(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, delete_budget_operation)
}
fn write_budget(c: &Connection, f: &Value) -> R<()> {
    let id = field(f, "id");
    let month = text(f, "month", 200)?;
    let (_, next) = month_range(&month)?;
    let cat = text(f, "category", 200)?;
    category(c, "expense", &cat)?;
    let amount = positive(f)?;
    let all = field(f, "all_months") == "on";
    let mut save_id = if id.is_empty() { uid() } else { id.to_string() };
    if !id.is_empty() {
        let old = one(c, "SELECT month,all_months FROM budgets WHERE id=?", [id])?;
        if old.is_null() {
            return Err("Budget not found.".into());
        }
        if old["all_months"] == 1 && !all {
            save_id = uid();
            if old["month"] == month {
                exec(
                    c,
                    "UPDATE budgets SET month=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM budgets WHERE category=? AND month=?)",
                    params![&next[..7], id, cat, &next[..7]],
                )?;
                exec(c, "DELETE FROM budgets WHERE id=? AND month=?", params![id, month])?;
            }
        } else {
            exec(c, "DELETE FROM budgets WHERE id=?", [id])?;
        }
    }
    if all {
        exec(
            c,
            "DELETE FROM budgets WHERE category=? AND month>=? AND all_months=1",
            params![cat, month],
        )?;
    }
    exec(
        c,
        "INSERT INTO budgets(id,month,category,amount,all_months) VALUES (?,?,?,?,?) ON CONFLICT(month,category) DO UPDATE SET amount=excluded.amount,all_months=excluded.all_months",
        params![save_id, month, cat, amount, all as i32],
    )?;
    Ok(())
}
