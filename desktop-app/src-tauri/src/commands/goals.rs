use super::shared::*;
pub(super) fn save_goal_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    if !id.is_empty() {
        record(c, "goals", id)?;
    }
    let name = text(f, "name", 80)?;
    let amount = positive(f)?;
    let d = text(f, "target_date", 200)?;
    date(&d)?;
    if id.is_empty() {
        exec(
            c,
            "INSERT INTO goals(id,name,amount,target_date) VALUES (?,?,?,?)",
            params![uid(), name, amount, d],
        )?;
    } else {
        exec(
            c,
            "UPDATE goals SET name=?,amount=?,target_date=? WHERE id=?",
            params![name, amount, d, id],
        )?;
    }
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn save_goal(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_goal_operation)
}
pub(super) fn add_contribution_operation(c: &Connection, f: &Value) -> R<Value> {
    let goal = text(f, "goal_id", 200)?;
    record(c, "goals", &goal)?;
    let d = text(f, "date", 200)?;
    date(&d)?;
    exec(
        c,
        "INSERT INTO contributions(id,goal_id,amount,date) VALUES (?,?,?,?)",
        params![uid(), goal, positive(f)?, d],
    )?;
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn add_contribution(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, add_contribution_operation)
}
pub(super) fn delete_contribution_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    record(c, "contributions", id)?;
    exec(c, "DELETE FROM contributions WHERE id=?", [id])?;
    Ok(message("Saved successfully."))
}
#[tauri::command]
pub fn delete_contribution(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, delete_contribution_operation)
}
