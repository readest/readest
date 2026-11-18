//! A trace or console line reaches stderr in one write. `eprintln!` writes each piece of its
//! format as it goes (stderr is unbuffered): a JSON trace line took ~16 writes, and on the Kindle,
//! where stderr is a file on its FUSE storage, every write is a round trip to the FUSE daemon.

use std::io::Write;

/// Counts the writes it is given and keeps their bytes.
#[derive(Default)]
struct Writes {
    count: usize,
    bytes: Vec<u8>,
}

impl Write for Writes {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.count += 1;
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_formatted_line_is_one_write() {
    let mut out = Writes::default();
    let (t_ms, poll_ms, label) = (12.5, 3.25, "tick");
    blitz_qjs_script::write_line(
        &mut out,
        format_args!("{{\"label\": \"{label}\", \"t_ms\": {t_ms:.1}, \"poll_ms\": {poll_ms:.1}}}"),
    );
    assert_eq!(out.count, 1);
    assert_eq!(
        String::from_utf8(out.bytes).unwrap(),
        "{\"label\": \"tick\", \"t_ms\": 12.5, \"poll_ms\": 3.2}\n"
    );
}

#[test]
fn writeln_would_split_the_same_line() {
    // What `eprintln!` does with the same format: why the helper exists.
    let mut out = Writes::default();
    let (t_ms, poll_ms, label) = (12.5, 3.25, "tick");
    writeln!(
        out,
        "{{\"label\": \"{label}\", \"t_ms\": {t_ms:.1}, \"poll_ms\": {poll_ms:.1}}}"
    )
    .unwrap();
    assert!(out.count > 1, "{} writes", out.count);
}
