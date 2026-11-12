//! Compiles `src/bootstrap.js` to QuickJS bytecode (no source; debug info kept, so stacks name
//! bootstrap.js lines) in `OUT_DIR`, so the runtime reads it instead of parsing it at every launch.

use rquickjs::{Context, Runtime, qjs};

fn main() {
    println!("cargo:rerun-if-changed=src/bootstrap.js");
    let mut src = std::fs::read("src/bootstrap.js").unwrap();
    src.push(0);
    let rt = Runtime::new().unwrap();
    let bytes = Context::full(&rt).unwrap().with(|ctx| {
        let raw = ctx.as_raw().as_ptr();
        // SAFETY: raw calls on this context; both values made here are freed.
        unsafe {
            let f = qjs::JS_Eval(
                raw,
                src.as_ptr().cast(),
                (src.len() - 1) as _,
                c"bootstrap.js".as_ptr(),
                (qjs::JS_EVAL_TYPE_GLOBAL | qjs::JS_EVAL_FLAG_COMPILE_ONLY) as _,
            );
            if qjs::JS_IsException(f) {
                panic!("bootstrap.js does not compile: {:?}", ctx.catch());
            }
            let mut len = 0usize;
            let flags = qjs::JS_WRITE_OBJ_BYTECODE | qjs::JS_WRITE_OBJ_STRIP_SOURCE;
            let buf = qjs::JS_WriteObject(raw, (&mut len as *mut usize).cast(), f, flags as _);
            assert!(!buf.is_null(), "JS_WriteObject failed");
            let out = std::slice::from_raw_parts(buf, len).to_vec();
            qjs::js_free(raw, buf.cast());
            qjs::JS_FreeValue(raw, f);
            out
        }
    });
    std::fs::write(
        format!("{}/bootstrap.qjsc", std::env::var("OUT_DIR").unwrap()),
        bytes,
    )
    .unwrap();
}
