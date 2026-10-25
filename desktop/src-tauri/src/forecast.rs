use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::state::Shared;

// the script ships inside the app, written next to salli.json on first use
const SCRIPT: &str = include_str!("../forecast/forecast.py");

#[tauri::command]
pub(crate) async fn forecast(
    state: tauri::State<'_, Shared>,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let script = state
        .data_path
        .parent()
        .ok_or("no data folder")?
        .join("forecast.py");
    if std::fs::read_to_string(&script).ok().as_deref() != Some(SCRIPT) {
        std::fs::write(&script, SCRIPT).map_err(|e| e.to_string())?;
    }
    let body = input.to_string();
    tauri::async_runtime::spawn_blocking(move || run(&script, &body))
        .await
        .map_err(|e| e.to_string())?
}

fn pythons() -> Vec<(String, Vec<String>)> {
    let mut list = Vec::new();
    // lets you point salli at a venv python
    if let Ok(p) = std::env::var("SALLI_PYTHON") {
        list.push((p, vec![]));
    }
    list.push(("python".into(), vec![]));
    list.push(("py".into(), vec!["-3".into()]));
    list.push(("python3".into(), vec![]));
    list
}

fn run(script: &PathBuf, body: &str) -> Result<serde_json::Value, String> {
    let mut last_err = "python not found".to_string();
    for (bin, pre) in pythons() {
        let mut cmd = Command::new(&bin);
        cmd.args(&pre)
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // no black console window popping up
            cmd.creation_flags(0x0800_0000);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(body.as_bytes());
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;

        if out.status.success() {
            return serde_json::from_slice(&out.stdout).map_err(|e| e.to_string());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        last_err = err
            .lines()
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("forecast failed")
            .to_string();
        // a real python that ran our script, no point trying the others
        if err.contains("forecast.py") || err.contains("tabpfn") || err.contains("need at least") {
            break;
        }
    }
    Err(last_err)
}
