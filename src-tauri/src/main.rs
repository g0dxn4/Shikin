// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let exit_code = shikin_lib::run_entrypoint(std::env::args_os());
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
