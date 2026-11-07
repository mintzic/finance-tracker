use super::shared::*;

#[tauri::command]
pub fn settings(state: NativeState<'_>) -> R<Value> {
    locked(&state)?.settings()
}
#[tauri::command]
pub fn create_ledger(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.create_ledger(&form)
}
#[tauri::command]
pub fn update_ledger(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.update_ledger(&form)
}
#[tauri::command]
pub fn switch_ledger(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.switch_ledger(&form)
}
#[tauri::command]
pub fn delete_ledger(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.delete_ledger(&form)
}
