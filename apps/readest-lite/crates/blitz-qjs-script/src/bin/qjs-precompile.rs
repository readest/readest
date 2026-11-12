//! `qjs-precompile DIR`: writes `<file>.qjsc` next to every `.js` under DIR: the script compiled as
//! a global script by this QuickJS build, as bytecode without the source. It keeps debug info, so a
//! stack names the script by its path under DIR (as the source maps do) with line and column.
//! Shipped with a frontend, it spares the device the compile on first launch: blitz-qjs-script asks the
//! loader for `<url>.qjsc` before `<url>`. Bytecode depends on the QuickJS version, not the CPU
//! (x86-64 output runs on armv7), and a mismatched file is detected on read and skipped.

use rquickjs::{Context, Runtime, qjs};

fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().is_some_and(|x| x == "js") {
            out.push(p);
        }
    }
}

fn main() {
    let dir = std::env::args().nth(1).expect("DIR");
    let mut files = Vec::new();
    walk(std::path::Path::new(&dir), &mut files);
    let rt = Runtime::new().unwrap();
    let (mut src_bytes, mut out_bytes, mut failed) = (0usize, 0usize, 0);
    Context::full(&rt).unwrap().with(|ctx| {
        let raw = ctx.as_raw().as_ptr();
        for f in &files {
            let mut src = std::fs::read(f).unwrap();
            src_bytes += src.len();
            src.push(0);
            let rel = f.strip_prefix(&dir).unwrap().to_string_lossy();
            let name = std::ffi::CString::new(format!("/{rel}")).unwrap();
            // SAFETY: raw QuickJS calls on this context; values are freed below.
            unsafe {
                let func = qjs::JS_Eval(
                    raw,
                    src.as_ptr().cast(),
                    (src.len() - 1) as _,
                    name.as_ptr(),
                    (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_COMPILE_ONLY) as _,
                );
                if qjs::JS_IsException(func) {
                    eprintln!("{}: {:?}", f.display(), ctx.catch());
                    failed += 1;
                    continue;
                }
                let mut len = 0usize;
                let flags = qjs::JS_WRITE_OBJ_BYTECODE | qjs::JS_WRITE_OBJ_STRIP_SOURCE;
                let buf =
                    qjs::JS_WriteObject(raw, (&mut len as *mut usize).cast(), func, flags as _);
                std::fs::write(
                    format!("{}.qjsc", f.display()),
                    std::slice::from_raw_parts(buf, len),
                )
                .unwrap();
                out_bytes += len;
                qjs::js_free(raw, buf.cast());
                qjs::JS_FreeValue(raw, func);
            }
        }
    });
    println!(
        "{{\"files\": {}, \"failed\": {failed}, \"source_kb\": {}, \"bytecode_kb\": {}}}",
        files.len(),
        src_bytes / 1024,
        out_bytes / 1024
    );
}
