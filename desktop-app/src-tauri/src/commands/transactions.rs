use super::{
    files,
    ledger::{parse_entry, write_entry},
    shared::*,
};
pub(super) fn save_transaction_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    let v = parse_entry(c, f)?;
    write_entry(c, &v, !id.is_empty())?;
    files::receipt(c, f, field(&v, "id"))?;
    Ok(message("Transaction saved."))
}
#[tauri::command]
pub fn save_transaction(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(
        &mut workspace.connection()?,
        &form,
        save_transaction_operation,
    )
}
pub(super) fn delete_transaction_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    record(c, "entries", id)?;
    exec(c, "DELETE FROM entries WHERE id=?", [id])?;
    Ok(message("Transaction deleted. Account balances updated."))
}
#[tauri::command]
pub fn delete_transaction(state: NativeState<'_>, form: Value) -> R<Value> {
    let workspace = locked(&state)?;
    transaction(
        &mut workspace.connection()?,
        &form,
        delete_transaction_operation,
    )
}
