mod agents;
mod assemble;
mod compile;
mod frontmatter;
mod handoff;
mod hooks;
mod hooks_server;
mod preset;
mod project;
mod sessions;
mod settings;
mod tasks;
mod watcher;
mod worktree;

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
            app.manage(watcher::WatcherState::default());
            app.manage(sessions::SessionRegistry::default());
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
            agents::agents_scan,
            agents::agent_create,
            agents::agent_memory_ensure,
            agents::agent_save,
            agents::agent_rename,
            agents::agent_delete,
            agents::agent_convert,
            agents::skill_create,
            agents::skill_save,
            agents::skill_rename,
            agents::skill_delete,
            agents::agents_meta_write,
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
            handoff::handoff_write,
            tasks::tasks_scan,
            tasks::task_toggle,
            tasks::task_append,
            tasks::task_move,
            tasks::task_update,
            worktree::worktree_check,
            worktree::worktree_add,
            sessions::agent_session_spawn,
            sessions::agent_session_send,
            sessions::agent_session_kill,
            sessions::agent_session_restart,
            sessions::agent_session_list
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Quitting Cowtext must never leave agent children behind
            // (WO01 Block F contract §6.6).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                sessions::kill_all(&app_handle.state::<sessions::SessionRegistry>());
            }
        });
}
