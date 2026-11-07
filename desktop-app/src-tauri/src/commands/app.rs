#[tauri::command]
pub fn greeting(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
