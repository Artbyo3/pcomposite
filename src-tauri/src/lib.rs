#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_in_app(exe_path: String, file_path: String) -> Result<(), String> {
    std::process::Command::new(exe_path)
        .arg(file_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn run_command(exe_path: String, args: Vec<String>) -> Result<(), String> {
    std::process::Command::new(exe_path)
        .args(&args)
        .output()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn spawn_command(exe_path: String, args: Vec<String>) -> Result<(), String> {
    std::process::Command::new(exe_path)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_in_app, run_command, spawn_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
