mod assemble;
mod compile;
mod hooks;
mod hooks_server;
mod project;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(assemble::AssembleQueue::new(Arc::new(
                assemble::ClaudeRunner::default(),
            )));
            hooks_server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::scan_project,
            project::read_graph,
            project::write_graph,
            project::read_md_file,
            project::write_md_file,
            compile::compile_preview,
            compile::compile_write,
            assemble::assemble_node,
            assemble::refine_node,
            assemble::summarize_node,
            assemble::assemble_status,
            assemble::assemble_cancel,
            hooks::hooks_preview,
            hooks::hooks_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
