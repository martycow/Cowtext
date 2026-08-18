mod assemble;
mod compile;
mod handoff;
mod hooks;
mod hooks_server;
mod preset;
mod project;
mod settings;

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
            app.manage(handoff::HandoffRunner(Arc::new(
                assemble::ClaudeRunner::default(),
            )));
            settings::init(app.handle());
            hooks_server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::scan_project,
            project::read_graph,
            project::write_graph,
            project::read_md_file,
            project::write_md_file,
            project::rename_node_file,
            project::reveal_path,
            project::probe_project_dirs,
            compile::compile_preview,
            compile::compile_write,
            assemble::assemble_node,
            assemble::refine_node,
            assemble::summarize_node,
            assemble::assemble_status,
            assemble::assemble_cancel,
            hooks::hooks_preview,
            hooks::hooks_write,
            hooks::hooks_status,
            settings::read_app_settings,
            settings::write_app_settings,
            preset::preset_save,
            preset::preset_list,
            preset::preset_read,
            preset::preset_export,
            preset::preset_apply,
            handoff::handoff_generate,
            handoff::handoff_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
