// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod storage;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let storage =
                storage::Storage::new(app.path().app_data_dir()?).map_err(std::io::Error::other)?;
            app.manage(std::sync::Mutex::new(storage));
            Ok(())
        })
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
