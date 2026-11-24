//! Bounded, read-only audio sources. DEFLATE checkpoints never contain whole entries.
use miniz_oxide::inflate::stream::{inflate, InflateState};
use miniz_oxide::{DataFormat, MZFlush, MZStatus};
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use symphonia::core::io::MediaSource;

const CHUNK: usize = 64 * 1024;
const MAX_DIRECTORY: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: u64 = 65_536;

pub(super) fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// The worker replaces the token between operations; the source outlives each token.
#[derive(Clone)]
pub(super) struct Cancellation(Arc<RwLock<Arc<AtomicBool>>>);
impl Cancellation {
    pub(super) fn new(token: Arc<AtomicBool>) -> Self {
        Self(Arc::new(RwLock::new(token)))
    }
    pub(super) fn set(&self, token: Arc<AtomicBool>) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = token;
    }
    pub(super) fn check(&self) -> io::Result<()> {
        if self
            .0
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .load(Ordering::Relaxed)
        {
            // Interrupted is retried by read_exact, which would spin on cancellation.
            Err(io::Error::other("audio operation cancelled"))
        } else {
            Ok(())
        }
    }
}

pub(super) struct Window {
    file: File,
    start: u64,
    len: u64,
    pos: u64,
    cancel: Cancellation,
    expected_crc: Option<u32>,
    crc: u32,
    crc_pos: u64,
}
impl Window {
    fn open(path: &Path, start: u64, end: Option<u64>, cancel: Cancellation) -> io::Result<Self> {
        cancel.check()?;
        let mut file = File::open(path)?;
        let file_len = file.metadata()?.len();
        let end = end.unwrap_or(file_len);
        if start >= end || end > file_len {
            return Err(invalid("invalid audio byte window (end is exclusive)"));
        }
        file.seek(SeekFrom::Start(start))?;
        Ok(Self {
            file,
            start,
            len: end - start,
            pos: 0,
            cancel,
            expected_crc: None,
            crc: u32::MAX,
            crc_pos: 0,
        })
    }
}
fn seek_target(from: SeekFrom, pos: u64, len: u64) -> io::Result<u64> {
    let target = match from {
        SeekFrom::Start(n) => i128::from(n),
        SeekFrom::Current(n) => i128::from(pos) + i128::from(n),
        SeekFrom::End(n) => i128::from(len) + i128::from(n),
    };
    if !(0..=i128::from(len)).contains(&target) {
        return Err(invalid("seek outside audio source"));
    }
    Ok(target as u64)
}
impl Read for Window {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        self.cancel.check()?;
        let count = out.len().min(CHUNK).min((self.len - self.pos) as usize);
        let count = self.file.read(&mut out[..count])?;
        if count == 0 && self.pos < self.len && !out.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated audio window",
            ));
        }
        if self.expected_crc.is_some() && self.pos == self.crc_pos {
            self.crc = update_crc(self.crc, &out[..count]);
            self.crc_pos += count as u64;
            if self.crc_pos == self.len && self.expected_crc != Some(!self.crc) {
                return Err(invalid("ZIP audio CRC mismatch"));
            }
        }
        self.pos += count as u64;
        Ok(count)
    }
}
impl Seek for Window {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.cancel.check()?;
        let target = seek_target(from, self.pos, self.len)?;
        self.file.seek(SeekFrom::Start(self.start + target))?;
        self.pos = target;
        if target == 0 {
            self.crc = u32::MAX;
            self.crc_pos = 0;
        }
        Ok(target)
    }
}

// Bound allocations before ZipArchive builds its central-directory index. ZIP64 is
// supported, but multi-disk archives and oversized directories are not audio sources.
fn check_directory(file: &mut Window) -> io::Result<()> {
    let size = file.len.min(65_557) as usize;
    file.seek(SeekFrom::End(-(size as i64)))?;
    let mut tail = vec![0; size];
    file.read_exact(&mut tail)?;
    let offset = (0..size.saturating_sub(21))
        .rev()
        .find(|&i| {
            tail[i..i + 4] == *b"PK\x05\x06"
                && i + 22 + usize::from(u16::from_le_bytes([tail[i + 20], tail[i + 21]])) == size
        })
        .ok_or_else(|| invalid("missing ZIP end directory"))?;
    let eocd = &tail[offset..];
    let short = |i| u16::from_le_bytes(eocd[i..i + 2].try_into().unwrap());
    let word = |i| u32::from_le_bytes(eocd[i..i + 4].try_into().unwrap());
    if short(4) != 0 || short(6) != 0 || short(8) != short(10) {
        return Err(invalid("multi-disk ZIP audio is unsupported"));
    }
    let mut count = u64::from(short(10));
    let mut bytes = u64::from(word(12));
    let mut directory_end = file.len - size as u64 + offset as u64;
    if count == u64::from(u16::MAX) || bytes == u64::from(u32::MAX) || word(16) == u32::MAX {
        let end = file.len - size as u64 + offset as u64;
        if end < 20 {
            return Err(invalid("missing ZIP64 locator"));
        }
        file.seek(SeekFrom::Start(end - 20))?;
        let mut locator = [0; 20];
        file.read_exact(&mut locator)?;
        if &locator[..4] != b"PK\x06\x07"
            || locator[4..8] != [0; 4]
            || locator[16..] != 1u32.to_le_bytes()
        {
            return Err(invalid("invalid ZIP64 locator"));
        }
        let pos = u64::from_le_bytes(locator[8..16].try_into().unwrap());
        if pos.checked_add(56).is_none_or(|n| n > end - 20) {
            return Err(invalid("invalid ZIP64 directory"));
        }
        file.seek(SeekFrom::Start(pos))?;
        let mut record = [0; 56];
        file.read_exact(&mut record)?;
        if &record[..4] != b"PK\x06\x06"
            || record[16..24] != [0; 8]
            || record[24..32] != record[32..40]
        {
            return Err(invalid("invalid ZIP64 directory"));
        }
        let record_size = u64::from_le_bytes(record[4..12].try_into().unwrap());
        if record_size < 44
            || pos
                .checked_add(12)
                .and_then(|n| n.checked_add(record_size))
                .is_none_or(|n| n > end - 20)
        {
            return Err(invalid("invalid ZIP64 end record size"));
        }
        directory_end = pos;
        count = u64::from_le_bytes(record[32..40].try_into().unwrap());
        bytes = u64::from_le_bytes(record[40..48].try_into().unwrap());
    }
    if count > MAX_ENTRIES || bytes > MAX_DIRECTORY || count > bytes / 46 {
        return Err(invalid(
            "ZIP central directory exceeds audio metadata limits",
        ));
    }
    let start = directory_end
        .checked_sub(bytes)
        .ok_or_else(|| invalid("ZIP central directory outside archive"))?;
    file.seek(SeekFrom::Start(start))?;
    let mut consumed = 0u64;
    for _ in 0..count {
        if bytes - consumed < 46 {
            return Err(invalid("truncated ZIP central directory"));
        }
        let mut header = [0; 46];
        file.read_exact(&mut header)?;
        if &header[..4] != b"PK\x01\x02" {
            return Err(invalid("invalid ZIP central directory header"));
        }
        let variable: u64 = [28usize, 30, 32]
            .iter()
            .map(|&i| u64::from(u16::from_le_bytes([header[i], header[i + 1]])))
            .sum();
        consumed += 46;
        if variable > bytes - consumed {
            return Err(invalid("ZIP directory fields exceed metadata bounds"));
        }
        consumed += variable;
        file.seek(SeekFrom::Start(start + consumed))?;
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(())
}

// Small local CRC implementation avoids another direct dependency. The table is
// generated at compile time and each checkpoint retains the CRC of its prefix.
const fn crc_table() -> [u32; 256] {
    let mut table = [0; 256];
    let mut i = 0;
    while i < 256 {
        let mut crc = i as u32;
        let mut bit = 0;
        while bit < 8 {
            crc = (crc >> 1) ^ (0xedb8_8320u32.wrapping_mul(crc & 1));
            bit += 1;
        }
        table[i] = crc;
        i += 1;
    }
    table
}
const CRC_TABLE: [u32; 256] = crc_table();
fn update_crc(mut crc: u32, bytes: &[u8]) -> u32 {
    for &byte in bytes {
        crc = (crc >> 8) ^ CRC_TABLE[((crc ^ u32::from(byte)) & 255) as usize];
    }
    crc
}
struct Checkpoint {
    pos: u64,
    compressed: u64,
    crc: u32,
    state: Box<InflateState>,
}
pub(super) struct Deflated {
    file: BufReader<Window>,
    compressed_len: u64,
    compressed: u64,
    len: u64,
    pos: u64,
    target: Option<u64>,
    state: Box<InflateState>,
    checkpoints: Vec<Checkpoint>,
    stride: u64,
    crc: u32,
    expected_crc: u32,
    finished: bool,
    cancel: Cancellation,
}
impl Deflated {
    fn restore(&mut self, index: usize) -> io::Result<()> {
        let checkpoint = &self.checkpoints[index];
        self.file.seek(SeekFrom::Start(checkpoint.compressed))?;
        self.state.clone_from(&checkpoint.state);
        self.pos = checkpoint.pos;
        self.compressed = checkpoint.compressed;
        self.crc = checkpoint.crc;
        self.finished = false;
        Ok(())
    }
    fn seek_now(&mut self, target: u64) -> io::Result<()> {
        let index = self.checkpoints.partition_point(|c| c.pos <= target) - 1;
        if target < self.pos || self.checkpoints[index].pos > self.pos {
            self.restore(index)?;
        }
        let mut discard = [0; CHUNK];
        while self.pos < target {
            let count = (target - self.pos).min(CHUNK as u64) as usize;
            if self.inflate_chunk(&mut discard[..count])? == 0 {
                return Err(invalid("ZIP entry ended during seek"));
            }
        }
        Ok(())
    }
    fn inflate_chunk(&mut self, out: &mut [u8]) -> io::Result<usize> {
        self.cancel.check()?;
        if self.finished {
            return Ok(0);
        }
        let size = (out.len() as u64)
            .min(CHUNK as u64)
            .min(self.len - self.pos)
            .min(self.stride - self.pos % self.stride) as usize;
        // A final scratch byte detects understated uncompressed size and forces
        // the end marker to be consumed even when it follows a full output block.
        let mut last = [0; 1];
        let output = if self.pos == self.len {
            &mut last[..]
        } else {
            &mut out[..size]
        };
        loop {
            self.cancel.check()?;
            let input = self.file.fill_buf()?;
            let available = input
                .len()
                .min((self.compressed_len - self.compressed) as usize);
            let result = inflate(&mut self.state, &input[..available], output, MZFlush::None);
            self.file.consume(result.bytes_consumed);
            self.compressed += result.bytes_consumed as u64;
            if result.status.is_err() || result.bytes_written as u64 > self.len - self.pos {
                return Err(invalid("invalid or truncated ZIP DEFLATE entry"));
            }
            self.crc = update_crc(self.crc, &output[..result.bytes_written]);
            self.pos += result.bytes_written as u64;
            if result.status == Ok(MZStatus::StreamEnd) {
                if self.pos != self.len || self.compressed != self.compressed_len {
                    return Err(invalid("ZIP DEFLATE size mismatch"));
                }
                if !self.crc != self.expected_crc {
                    return Err(invalid("ZIP audio CRC mismatch"));
                }
                self.finished = true;
            }
            if self.pos % self.stride == 0
                && self.checkpoints.last().unwrap().pos < self.pos
                && !self.finished
            {
                self.checkpoints.push(Checkpoint {
                    pos: self.pos,
                    compressed: self.compressed,
                    crc: self.crc,
                    state: self.state.clone(),
                });
            }
            if result.bytes_written > 0 || self.finished {
                return Ok(result.bytes_written);
            }
            if result.bytes_consumed == 0 {
                return Err(invalid("ZIP DEFLATE made no progress"));
            }
        }
    }
}
impl Read for Deflated {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        self.cancel.check()?;
        if out.is_empty() {
            return Ok(0);
        }
        if let Some(target) = self.target {
            self.seek_now(target)?;
            self.target = None;
        }
        let count = self.inflate_chunk(out)?;
        if self.pos == self.len && !self.finished {
            self.inflate_chunk(&mut [0; 1])?;
        }
        Ok(count)
    }
}
impl Seek for Deflated {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.cancel.check()?;
        let target = seek_target(from, self.target.unwrap_or(self.pos), self.len)?;
        self.target = Some(target);
        Ok(target)
    }
}

pub(super) enum AudioSource {
    File(Window),
    Deflated(Deflated),
}
impl AudioSource {
    pub(super) fn open(
        path: &Path,
        start: Option<u64>,
        end: Option<u64>,
        entry: Option<&str>,
        cancel: Cancellation,
    ) -> io::Result<Self> {
        if let Some(entry) = entry {
            if start.is_some() || end.is_some() {
                return Err(invalid("ZIP entry and byte window are mutually exclusive"));
            }
            let mut window = Window::open(path, 0, None, cancel.clone())?;
            check_directory(&mut window)?;
            let file_len = window.len;
            let mut archive = zip::ZipArchive::new(window)?;
            let directory = archive.central_directory_start();
            let member = archive.by_name(entry)?;
            if member.encrypted() {
                return Err(invalid("encrypted ZIP audio is unsupported"));
            }
            let data = member
                .data_start()
                .ok_or_else(|| invalid("ZIP audio data offset is unavailable"))?;
            let compressed = member.compressed_size();
            let len = member.size();
            if data
                .checked_add(compressed)
                .is_none_or(|n| n > file_len || n > directory)
            {
                return Err(invalid("ZIP audio extends outside archive data"));
            }
            let expected_crc = member.crc32();
            match member.compression() {
                zip::CompressionMethod::Stored => {
                    if compressed != len {
                        return Err(invalid("stored ZIP size mismatch"));
                    }
                    let mut source = Window::open(path, data, Some(data + len), cancel)?;
                    source.expected_crc = Some(expected_crc);
                    Ok(Self::File(source))
                }
                zip::CompressionMethod::Deflated => {
                    if len == 0 || compressed == 0 {
                        return Err(invalid("empty ZIP audio"));
                    }
                    let state = InflateState::new_boxed(DataFormat::Raw);
                    let checkpoints = vec![Checkpoint {
                        pos: 0,
                        compressed: 0,
                        crc: u32::MAX,
                        state: state.clone(),
                    }];
                    Ok(Self::Deflated(Deflated {
                        file: BufReader::with_capacity(
                            CHUNK,
                            Window::open(path, data, Some(data + compressed), cancel.clone())?,
                        ),
                        compressed_len: compressed,
                        compressed: 0,
                        len,
                        pos: 0,
                        target: None,
                        state,
                        checkpoints,
                        stride: len.div_ceil(1024).max(1024 * 1024),
                        crc: u32::MAX,
                        expected_crc,
                        finished: false,
                        cancel,
                    }))
                }
                _ => Err(invalid("unsupported ZIP audio compression")),
            }
        } else {
            Ok(Self::File(Window::open(
                path,
                start.unwrap_or(0),
                end,
                cancel,
            )?))
        }
    }
    pub(super) fn len(&self) -> u64 {
        match self {
            Self::File(s) => s.len,
            Self::Deflated(s) => s.len,
        }
    }
}
impl Read for AudioSource {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::File(s) => s.read(out),
            Self::Deflated(s) => s.read(out),
        }
    }
}
impl Seek for AudioSource {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        match self {
            Self::File(s) => s.seek(from),
            Self::Deflated(s) => s.seek(from),
        }
    }
}
impl MediaSource for AudioSource {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicU64;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        path: PathBuf,
        bytes: Vec<u8>,
    }
    impl Fixture {
        fn new(method: zip::CompressionMethod) -> Self {
            let path = std::env::temp_dir().join(format!(
                "readest-source-{}-{}.zip",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let mut state = 7084u32;
            let bytes: Vec<u8> = (0..3 * 1024 * 1024 + 17)
                .map(|i| {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    if i % 1024 < 500 {
                        (i % 17) as u8
                    } else {
                        state as u8
                    }
                })
                .collect();
            let mut writer = zip::ZipWriter::new(File::create(&path).unwrap());
            writer
                .start_file(
                    "audio.m4a",
                    zip::write::SimpleFileOptions::default().compression_method(method),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
            writer.finish().unwrap();
            Self { path, bytes }
        }
        fn source(&self) -> AudioSource {
            AudioSource::open(
                &self.path,
                None,
                None,
                Some("audio.m4a"),
                Cancellation::new(Arc::new(AtomicBool::new(false))),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
    #[test]
    fn stored_crc_is_reported_after_full_read() {
        let fixture = Fixture::new(zip::CompressionMethod::Stored);
        let mut bytes = std::fs::read(&fixture.path).unwrap();
        let offset = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
        bytes[offset + 16] ^= 1;
        std::fs::write(&fixture.path, bytes).unwrap();
        let error = io::copy(&mut fixture.source(), &mut io::sink())
            .expect_err("stored CRC must be checked when a full prefix is read");
        assert!(error.to_string().contains("CRC"));
    }
    #[test]
    fn corrupt_crc_is_reported_after_full_inflate() {
        let fixture = Fixture::new(zip::CompressionMethod::Deflated);
        let mut bytes = std::fs::read(&fixture.path).unwrap();
        let offset = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
        bytes[offset + 16] ^= 1;
        std::fs::write(&fixture.path, bytes).unwrap();
        let error = io::copy(&mut fixture.source(), &mut io::sink())
            .expect_err("a full inflate must reject an incorrect ZIP CRC");
        assert!(error.to_string().contains("CRC"));
    }
    #[test]
    fn stored_and_deflated_seeks_match_exact_bytes() {
        for method in [
            zip::CompressionMethod::Stored,
            zip::CompressionMethod::Deflated,
        ] {
            let fixture = Fixture::new(method);
            let mut source = fixture.source();
            let mut all = Vec::new();
            source.read_to_end(&mut all).unwrap();
            assert_eq!(all, fixture.bytes);
            for offset in [
                2_900_003,
                1_048_575,
                0,
                1_048_576,
                1_048_577,
                fixture.bytes.len() as u64 - 3,
            ] {
                source.seek(SeekFrom::Start(offset)).unwrap();
                let count = 71.min(fixture.bytes.len() - offset as usize);
                let mut out = vec![0; count];
                source.read_exact(&mut out).unwrap();
                assert_eq!(out, fixture.bytes[offset as usize..offset as usize + count]);
            }
            assert!(source.seek(SeekFrom::End(1)).is_err());
            assert!(source.seek(SeekFrom::Start(u64::MAX)).is_err());
        }
    }
    #[test]
    fn cancellation_can_be_replaced_without_losing_index() {
        let fixture = Fixture::new(zip::CompressionMethod::Deflated);
        let token = Arc::new(AtomicBool::new(false));
        let cancel = Cancellation::new(token.clone());
        let mut source =
            AudioSource::open(&fixture.path, None, None, Some("audio.m4a"), cancel.clone())
                .unwrap();
        source.seek(SeekFrom::Start(2_900_000)).unwrap();
        let mut out = [0; 40];
        source.read_exact(&mut out).unwrap();
        token.store(true, Ordering::Relaxed);
        assert!(source
            .read(&mut out)
            .unwrap_err()
            .to_string()
            .contains("cancelled"));
        cancel.set(Arc::new(AtomicBool::new(false)));
        source.seek(SeekFrom::Start(1_100_000)).unwrap();
        source.read_exact(&mut out).unwrap();
        assert_eq!(&out, &fixture.bytes[1_100_000..1_100_040]);
        let AudioSource::Deflated(source) = source else {
            panic!()
        };
        assert!(source.checkpoints.len() >= 3);
        assert!(source.len.div_ceil(source.stride) <= 1024);
        assert!(1025 * std::mem::size_of::<InflateState>() < 45 * 1024 * 1024);
    }
    #[test]
    fn cancellation_interrupts_forward_inflate_and_can_resume() {
        let fixture = Fixture::new(zip::CompressionMethod::Deflated);
        let token = Arc::new(AtomicBool::new(false));
        let cancel = Cancellation::new(token.clone());
        let mut source =
            AudioSource::open(&fixture.path, None, None, Some("audio.m4a"), cancel.clone())
                .unwrap();
        source.seek(SeekFrom::Start(2_900_000)).unwrap();
        // Cancel after the first IO chunk of a forward inflate, before the next.
        let AudioSource::Deflated(inner) = &mut source else {
            panic!()
        };
        let mut chunk = [0; CHUNK];
        inner.inflate_chunk(&mut chunk).unwrap();
        assert!(inner.pos > 0 && inner.pos < 2_900_000);
        token.store(true, Ordering::Relaxed);
        assert!(source
            .read(&mut chunk)
            .unwrap_err()
            .to_string()
            .contains("cancelled"));
        cancel.set(Arc::new(AtomicBool::new(false)));
        source.read_exact(&mut chunk).unwrap();
        assert_eq!(&chunk, &fixture.bytes[2_900_000..2_900_000 + CHUNK]);
    }
    #[test]
    fn zip_directory_and_entry_sizes_are_validated() {
        for field in [20usize, 24] {
            let fixture = Fixture::new(zip::CompressionMethod::Deflated);
            let mut bytes = std::fs::read(&fixture.path).unwrap();
            let central = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
            let old = u32::from_le_bytes(
                bytes[central + field..central + field + 4]
                    .try_into()
                    .unwrap(),
            );
            bytes[central + field..central + field + 4].copy_from_slice(&(old + 1).to_le_bytes());
            std::fs::write(&fixture.path, bytes).unwrap();
            if let Ok(mut source) = AudioSource::open(
                &fixture.path,
                None,
                None,
                Some("audio.m4a"),
                Cancellation::new(Arc::new(AtomicBool::new(false))),
            ) {
                assert!(io::copy(&mut source, &mut io::sink()).is_err());
            }
        }
        let fixture = Fixture::new(zip::CompressionMethod::Deflated);
        let mut bytes = std::fs::read(&fixture.path).unwrap();
        let end = bytes.len() - 22;
        bytes[end + 12..end + 16].copy_from_slice(&(MAX_DIRECTORY as u32 + 1).to_le_bytes());
        std::fs::write(&fixture.path, bytes).unwrap();
        assert!(AudioSource::open(
            &fixture.path,
            None,
            None,
            Some("audio.m4a"),
            Cancellation::new(Arc::new(AtomicBool::new(false)))
        )
        .is_err());
    }
    #[test]
    fn invalid_windows_and_truncation_fail() {
        let fixture = Fixture::new(zip::CompressionMethod::Deflated);
        let cancel = Cancellation::new(Arc::new(AtomicBool::new(false)));
        assert!(AudioSource::open(&fixture.path, Some(2), Some(1), None, cancel.clone()).is_err());
        assert!(
            AudioSource::open(&fixture.path, Some(0), None, Some("audio.m4a"), cancel).is_err()
        );
        let mut source = fixture.source();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&fixture.path)
            .unwrap()
            .set_len(100)
            .unwrap();
        assert!(io::copy(&mut source, &mut io::sink()).is_err());
    }
}
