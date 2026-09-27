use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const ENGINES: [&str; 3] = ["pdflatex", "xelatex", "lualatex"];
const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PDF_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SYNCTEX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_LOG_BYTES: usize = 1024 * 1024;
const COMPILE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexCompileResult {
    engine: String,
    pdf_base64: String,
    sync_tex_base64: String,
    log: String,
}

#[derive(Default)]
pub struct LatexJobState(Mutex<HashMap<String, Arc<AtomicBool>>>);

fn engine_name(engine: &str) -> Result<&str, String> {
    ENGINES
        .into_iter()
        .find(|allowed| *allowed == engine)
        .ok_or_else(|| "不支持的 LaTeX 引擎".to_string())
}

fn output_limited(path: &Path, max_bytes: usize) -> String {
    let bytes = fs::read(path).unwrap_or_default();
    let start = bytes.len().saturating_sub(max_bytes);
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

fn read_output(path: &Path, max_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| format!("LaTeX 未生成 {label}"))?;
    if metadata.len() > max_bytes {
        return Err(format!("生成的 {label} 超过大小限制"));
    }
    fs::read(path).map_err(|error| format!("读取生成的 {label} 失败：{error}"))
}

fn compile_in_temp(
    engine: &str,
    source: &str,
    cancelled: &AtomicBool,
) -> Result<LatexCompileResult, String> {
    if source.is_empty() || source.len() > MAX_SOURCE_BYTES {
        return Err("LaTeX 源码为空或超过 2 MiB".to_string());
    }
    if source.as_bytes().contains(&0) {
        return Err("LaTeX 源码包含无效的空字节".to_string());
    }

    let engine = engine_name(engine)?;
    let work_dir = std::env::temp_dir().join(format!(
        "readest-latex-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&work_dir).map_err(|error| format!("创建编译目录失败：{error}"))?;
    let result = (|| {
        fs::write(work_dir.join("source.tex"), source)
            .map_err(|error| format!("暂存 LaTeX 源码失败：{error}"))?;
        let log_path = work_dir.join("process.log");
        let stdout =
            fs::File::create(&log_path).map_err(|error| format!("创建编译日志失败：{error}"))?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("创建编译日志失败：{error}"))?;

        let mut command = Command::new(engine);
        command
            .current_dir(&work_dir)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .env("openin_any", "p")
            .env("openout_any", "p")
            .args([
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                "-synctex=1",
                "-no-shell-escape",
                "source.tex",
            ]);
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动 {engine}：{error}"))?;
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None)
                    if !cancelled.load(Ordering::Relaxed)
                        && started.elapsed() < COMPILE_TIMEOUT =>
                {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let reason = if cancelled.load(Ordering::Relaxed) {
                        "已取消"
                    } else {
                        "超过 30 秒，已超时"
                    };
                    return Err(format!("{engine} {reason}"));
                }
                Err(error) => return Err(format!("等待 {engine} 时出错：{error}")),
            }
        };
        let log = output_limited(&log_path, MAX_LOG_BYTES);
        if !status.success() {
            return Err(format!("{engine} 编译失败\n{log}"));
        }
        let pdf = read_output(&work_dir.join("source.pdf"), MAX_PDF_BYTES, "PDF")?;
        let sync_tex = read_output(
            &work_dir.join("source.synctex.gz"),
            MAX_SYNCTEX_BYTES,
            "SyncTeX 映射",
        )?;
        Ok(LatexCompileResult {
            engine: engine.to_string(),
            pdf_base64: STANDARD.encode(pdf),
            sync_tex_base64: STANDARD.encode(sync_tex),
            log,
        })
    })();
    let _ = fs::remove_dir_all(&work_dir);
    result
}

#[tauri::command]
pub fn detect_latex_engines() -> Vec<String> {
    ENGINES
        .into_iter()
        .filter(|engine| {
            Command::new(engine)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        })
        .map(str::to_string)
        .collect()
}

#[tauri::command]
pub async fn compile_latex_source(
    state: tauri::State<'_, LatexJobState>,
    job_id: String,
    engine: String,
    source: String,
) -> Result<LatexCompileResult, String> {
    uuid::Uuid::parse_str(&job_id).map_err(|_| "LaTeX 任务 ID 无效".to_string())?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.0.lock().map_err(|_| "LaTeX 任务状态不可用")?;
        if jobs.contains_key(&job_id) {
            return Err("这个 LaTeX 任务已在运行".to_string());
        }
        jobs.insert(job_id.clone(), cancelled.clone());
    }
    let task_result =
        tauri::async_runtime::spawn_blocking(move || compile_in_temp(&engine, &source, &cancelled))
            .await;
    state
        .0
        .lock()
        .map_err(|_| "LaTeX 任务状态不可用")?
        .remove(&job_id);
    task_result.map_err(|error| format!("LaTeX 编译任务失败：{error}"))?
}

#[tauri::command]
pub fn cancel_latex_compile(
    state: tauri::State<'_, LatexJobState>,
    job_id: String,
) -> Result<bool, String> {
    let jobs = state.0.lock().map_err(|_| "LaTeX 任务状态不可用")?;
    let Some(cancelled) = jobs.get(&job_id) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_engines() {
        assert_eq!(engine_name("sh"), Err("不支持的 LaTeX 引擎".to_string()));
    }

    #[test]
    fn cancels_a_started_compile() {
        if !detect_latex_engines()
            .iter()
            .any(|engine| engine == "pdflatex")
        {
            return;
        }
        let cancelled = AtomicBool::new(true);
        let error = compile_in_temp(
            "pdflatex",
            "\\documentclass{article}\\begin{document}Readest\\end{document}",
            &cancelled,
        )
        .expect_err("a cancelled build must not return generated files");
        assert!(error.contains("已取消"));
    }
}
