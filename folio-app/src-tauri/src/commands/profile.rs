use super::shared::*;

#[tauri::command]
pub fn update_profile(state: NativeState<'_>, form: Value) -> R<Value> {
    locked(&state)?.update_profile(&form)
}
