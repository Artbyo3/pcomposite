use tauri_plugin_sql::{Migration, MigrationKind};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    stage INTEGER,
                    thumb TEXT,
                    platform_tags TEXT
                );
                CREATE TABLE IF NOT EXISTS folders (
                    project_id TEXT,
                    name TEXT,
                    color TEXT,
                    desc TEXT
                );
                CREATE TABLE IF NOT EXISTS checklist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT,
                    label TEXT,
                    done INTEGER
                );
                CREATE TABLE IF NOT EXISTS pipeline_steps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT,
                    step_index INTEGER,
                    done INTEGER
                );
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id TEXT,
                    folder_name TEXT,
                    name TEXT,
                    ext TEXT,
                    size_bytes INTEGER,
                    app TEXT,
                    created_at TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_settings_table",
            sql: "
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:pcomposite.db", migrations)
            .build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_in_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
