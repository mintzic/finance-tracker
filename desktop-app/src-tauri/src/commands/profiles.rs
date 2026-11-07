use super::shared::*;
#[tauri::command]
pub fn profiles(state: NativeState<'_>) -> R<Value> {
    locked(&state)?.profiles()
}
#[tauri::command]
pub fn create_profile(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.create_profile(&form)
}
#[tauri::command]
pub fn update_profile(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.update_profile(&form)
}
#[tauri::command]
pub fn switch_profile(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.switch_profile(&form)
}
