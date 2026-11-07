use super::{
    files,
    ledger::{parse_transaction, write_transaction},
    shared::*,
};
pub(super) fn save_transaction_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    let v = parse_transaction(c, f)?;
    write_transaction(c, &v, !id.is_empty())?;
    files::receipt(c, f, field(&v, "id"))?;
    Ok(message("Transaction saved."))
}
#[tauri::command]
pub fn save_transaction(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_transaction_operation)
}
pub(super) fn delete_transaction_operation(c: &Connection, f: &Value) -> R<Value> {
    let id = field(f, "id");
    record(c, "transactions", id)?;
    exec(c, "DELETE FROM transactions WHERE id=?", [id])?;
    Ok(message("Transaction deleted. Account balances updated."))
}
#[tauri::command]
pub fn delete_transaction(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, delete_transaction_operation)
}
