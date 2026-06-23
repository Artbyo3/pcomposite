use tauri::Manager;

#[cfg(target_os = "windows")]
mod drag;

#[cfg(target_os = "windows")]
#[tauri::command]
fn drag_addon(app: tauri::AppHandle) -> Result<(), String> {
    let hwnd = app
        .get_webview_window("main")
        .ok_or("main window not found")?
        .hwnd()
        .map_err(|e: tauri::Error| e.to_string())?;
    drag::drag_addon(hwnd.0)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn drag_addon() -> Result<(), String> {
    Err("Drag-and-drop is only supported on Windows".to_string())
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

#[cfg(target_os = "windows")]
#[tauri::command]
fn focus_blender() -> Result<(), String> {
    extern "system" {
        fn FindWindowW(lpClassName: *const u16, lpWindowName: *const u16) -> isize;
        fn SetForegroundWindow(hWnd: isize) -> i32;
    }
    let class: Vec<u16> = "Blender\0".encode_utf16().collect();
    let hwnd = unsafe { FindWindowW(std::ptr::null(), class.as_ptr()) };
    if hwnd == 0 {
        return Err("Blender window not found".to_string());
    }
    unsafe { SetForegroundWindow(hwnd); }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn focus_blender() -> Result<(), String> {
    Err("Focus Blender is only supported on Windows".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_in_app, run_command, spawn_command, drag_addon, focus_blender])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
