//! Native interleaved PCM decoder, including MP4 presentation edits.
use super::zip_source::{invalid, AudioSource, Cancellation};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use symphonia::core::codecs::audio::{
    AudioCodecParameters, AudioDecoder as Decoder, AudioDecoderOptions,
};
use symphonia::core::common::Limit;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{TimeBase, Timestamp};

fn make_decoder(params: &AudioCodecParameters) -> Result<Box<dyn Decoder>, String> {
    symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|e| e.to_string())
}

#[derive(Clone, Copy)]
struct Atom {
    kind: [u8; 4],
    data: u64,
    end: u64,
}
fn atom<R: Read + Seek>(source: &mut R, pos: u64, end: u64) -> io::Result<Atom> {
    if end.saturating_sub(pos) < 8 {
        return Err(invalid("truncated MP4 atom"));
    }
    source.seek(SeekFrom::Start(pos))?;
    let mut header = [0; 8];
    source.read_exact(&mut header)?;
    let size = u32::from_be_bytes(header[..4].try_into().unwrap());
    let kind = header[4..].try_into().unwrap();
    let (size, head) = match size {
        0 => (end - pos, 8),
        1 => {
            source.read_exact(&mut header)?;
            (u64::from_be_bytes(header), 16)
        }
        n => (u64::from(n), 8),
    };
    if size < head || size > end - pos {
        return Err(invalid("invalid MP4 atom size"));
    }
    Ok(Atom {
        kind,
        data: pos + head,
        end: pos + size,
    })
}
fn child<R: Read + Seek>(
    source: &mut R,
    parent: Atom,
    kind: &[u8; 4],
    mut index: u32,
) -> io::Result<Option<Atom>> {
    let mut pos = parent.data;
    while pos < parent.end {
        let item = atom(source, pos, parent.end)?;
        if &item.kind == kind {
            if index == 0 {
                return Ok(Some(item));
            }
            index -= 1;
        }
        pos = item.end;
    }
    Ok(None)
}
fn be32<R: Read>(source: &mut R) -> io::Result<u32> {
    let mut bytes = [0; 4];
    source.read_exact(&mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}
fn field<R: Read + Seek>(source: &mut R, item: Atom, offset: u64) -> io::Result<u32> {
    if offset
        .checked_add(4)
        .is_none_or(|n| n > item.end - item.data)
    {
        return Err(invalid("truncated MP4 field"));
    }
    source.seek(SeekFrom::Start(item.data + offset))?;
    be32(source)
}

// Bound MP4 table allocations. Validate count fields
// against their atom and a total metadata budget before invoking the demuxer.
fn validate_metadata<R: Read + Seek>(
    source: &mut R,
    parent: Atom,
    depth: u32,
    budget: &mut u64,
) -> io::Result<()> {
    if depth > 12 {
        return Err(invalid("MP4 metadata nesting limit"));
    }
    let mut pos = parent.data;
    while pos < parent.end {
        let item = atom(source, pos, parent.end)?;
        let len = item.end - item.data;
        match &item.kind {
            b"moov" | b"trak" | b"mdia" | b"minf" | b"stbl" | b"edts" | b"udta" => {
                validate_metadata(source, item, depth + 1, budget)?
            }
            b"stts" | b"ctts" | b"stsc" | b"stco" | b"co64" | b"stss" | b"stsz" => {
                let count_offset = if &item.kind == b"stsz" { 8 } else { 4 };
                let count = u64::from(field(source, item, count_offset)?);
                let width = match &item.kind {
                    b"stts" | b"ctts" | b"co64" => 8,
                    b"stsc" => 12,
                    _ => 4,
                };
                let constant = &item.kind == b"stsz" && field(source, item, 4)? != 0;
                let allocation = if constant { 0 } else { count * width };
                if count > 4_000_000
                    || allocation > len.saturating_sub(count_offset + 4)
                    || allocation > *budget
                {
                    return Err(invalid("MP4 sample table exceeds metadata limits"));
                }
                *budget -= allocation;
            }
            b"stsd" => {
                if u64::from(field(source, item, 4)?) > 64 || len > 1024 * 1024 {
                    return Err(invalid("MP4 sample description exceeds metadata limits"));
                }
            }
            b"meta" | b"ilst" if len > 4 * 1024 * 1024 => {
                return Err(invalid("MP4 tags exceed metadata limits"))
            }
            _ => (),
        }
        pos = item.end;
    }
    Ok(())
}

#[derive(Clone, Copy, Default)]
struct Edit {
    start: u64,
    silence: u64,
    frames: Option<u64>,
}
struct Mp4 {
    moov: Atom,
}
fn inspect_mp4(source: &mut AudioSource) -> io::Result<Option<Mp4>> {
    let len = source.len();
    let mut head = [0; 12];
    let count = source.read(&mut head)?;
    source.seek(SeekFrom::Start(0))?;
    if count < 8
        || !matches!(
            &head[4..8],
            b"ftyp" | b"moov" | b"mdat" | b"free" | b"wide" | b"skip"
        )
    {
        return Ok(None);
    }
    let root = Atom {
        kind: [0; 4],
        data: 0,
        end: len,
    };
    let moov = child(source, root, b"moov", 0)?.ok_or_else(|| invalid("missing MP4 movie"))?;
    if moov.end - moov.data > 64 * 1024 * 1024 {
        return Err(invalid("MP4 movie exceeds metadata limits"));
    }
    validate_metadata(source, moov, 0, &mut (64 * 1024 * 1024))?;
    source.seek(SeekFrom::Start(0))?;
    Ok(Some(Mp4 { moov }))
}
fn to_frames(ts: u64, tb: TimeBase, rate: u32) -> Result<u64, String> {
    u64::try_from(
        u128::from(ts) * u128::from(tb.numer.get()) * u128::from(rate) / u128::from(tb.denom.get()),
    )
    .map_err(|_| "audio timestamp overflow".into())
}
fn read_edit<R: Read + Seek>(
    source: &mut R,
    mp4: &Mp4,
    track: u32,
    time_base: TimeBase,
    rate: u32,
    frames: Option<u64>,
) -> io::Result<Edit> {
    let mvhd =
        child(source, mp4.moov, b"mvhd", 0)?.ok_or_else(|| invalid("missing MP4 timescale"))?;
    let version = field(source, mvhd, 0)? >> 24;
    if version > 1 {
        return Err(invalid("unsupported MP4 movie version"));
    }
    let scale = field(source, mvhd, if version == 1 { 20 } else { 12 })?;
    if scale == 0 {
        return Err(invalid("invalid MP4 timescale"));
    }
    // Use the trak ordinal; Symphonia 0.6 IDs are the tkhd track ID.
    let trak = child(source, mp4.moov, b"trak", track)?
        .ok_or_else(|| invalid("missing MP4 audio track"))?;
    let mut edit = Edit {
        frames,
        ..Default::default()
    };
    let Some(edts) = child(source, trak, b"edts", 0)? else {
        return Ok(edit);
    };
    let Some(elst) = child(source, edts, b"elst", 0)? else {
        return Ok(edit);
    };
    let version = field(source, elst, 0)? >> 24;
    let count = field(source, elst, 4)?;
    if version > 1 || !(1..=2).contains(&count) {
        return Err(invalid("unsupported MP4 edit list"));
    }
    if elst.end - elst.data != 8 + u64::from(count) * if version == 1 { 20 } else { 12 } {
        return Err(invalid("invalid MP4 edit list size"));
    }
    source.seek(SeekFrom::Start(elst.data + 8))?;
    for index in 0..count {
        let (duration, time) = if version == 1 {
            let mut bytes = [0; 8];
            source.read_exact(&mut bytes)?;
            let duration = u64::from_be_bytes(bytes);
            source.read_exact(&mut bytes)?;
            (duration, i64::from_be_bytes(bytes))
        } else {
            (u64::from(be32(source)?), i64::from(be32(source)? as i32))
        };
        if be32(source)? != 0x0001_0000 {
            return Err(invalid("unsupported MP4 edit rate"));
        }
        let duration = u64::try_from(u128::from(duration) * u128::from(rate) / u128::from(scale))
            .map_err(|_| invalid("MP4 edit duration overflow"))?;
        if time == -1 && index == 0 && count == 2 {
            edit.silence = duration;
        } else if time >= 0 && index == count - 1 {
            edit.start = to_frames(time as u64, time_base, rate).map_err(|e| invalid(&e))?;
            let media_frames =
                frames.map_or(duration, |n| n.saturating_sub(edit.start).min(duration));
            edit.frames = Some(
                media_frames
                    .checked_add(edit.silence)
                    .ok_or_else(|| invalid("MP4 edit duration overflow"))?,
            );
        } else {
            return Err(invalid("unsupported MP4 edit sequence"));
        }
    }
    Ok(edit)
}

pub(crate) struct AudioDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    params: AudioCodecParameters,
    time_base: TimeBase,
    track: u32,
    rate: u32,
    channels: usize,
    edit: Edit,
    cursor: u64,
    packet: Vec<f32>,
    packet_start: u64,
    cancel: Cancellation,
    ended: bool,
}
impl AudioDecoder {
    /// `end` is exclusive. `entry` selects a stored or deflated ZIP member;
    /// ZIP names and byte windows are mutually exclusive.
    #[cfg(test)]
    pub(crate) fn open(
        path: PathBuf,
        start: Option<u64>,
        end: Option<u64>,
        entry: Option<String>,
    ) -> Result<Self, String> {
        Self::open_with_cancel(path, start, end, entry, Arc::new(AtomicBool::new(false)))
    }
    pub(crate) fn open_with_cancel(
        path: PathBuf,
        start: Option<u64>,
        end: Option<u64>,
        entry: Option<String>,
        token: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        Self::open_inner(path, start, end, entry, token).map_err(|e| e.to_string())
    }
    fn open_inner(
        path: PathBuf,
        start: Option<u64>,
        end: Option<u64>,
        entry: Option<String>,
        token: Arc<AtomicBool>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let cancel = Cancellation::new(token);
        let mut source = AudioSource::open(&path, start, end, entry.as_deref(), cancel.clone())?;
        let mp4 = inspect_mp4(&mut source)?;
        let mut hint = Hint::new();
        let name = entry
            .as_deref()
            .unwrap_or_else(|| path.to_str().unwrap_or(""));
        if let Some(extension) = std::path::Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
        {
            hint.with_extension(extension);
        }
        let stream = MediaSourceStream::new(Box::new(source), Default::default());
        let metadata_options = MetadataOptions::default()
            .limit_tag_bytes(Limit::Maximum(1024 * 1024))
            .limit_visual_bytes(Limit::Maximum(1024 * 1024));
        let mut format = symphonia::default::get_probe().probe(
            &hint,
            stream,
            FormatOptions::default(),
            metadata_options,
        )?;
        let ((ordinal, track), params) = format
            .tracks()
            .iter()
            .enumerate()
            .find_map(|(ordinal, track)| {
                let params = track.codec_params.as_ref()?.audio()?;
                make_decoder(params)
                    .ok()
                    .map(|_| ((ordinal, track), params))
            })
            .ok_or("no supported audio track")?;
        let id = track.id;
        let params = params.clone();
        let time_base = track.time_base.ok_or("missing audio time base")?;
        let duration = track.duration;
        let start_ts = track.start_ts;
        let mut decoder = make_decoder(&params)?;
        // The first decoded packet supplies authoritative AAC layout and rate.
        let (rate, channels, packet, packet_ts) = loop {
            cancel.check()?;
            let packet = format.next_packet()?.ok_or("audio has no packets")?;
            if packet.track_id != id {
                continue;
            }
            let audio = decoder.decode(&packet)?;
            if audio.is_empty() {
                continue;
            }
            let rate = audio.spec().rate();
            let channels = audio.spec().channels().count();
            let mut samples = Vec::<f32>::new();
            audio.copy_to_vec_interleaved(&mut samples);
            break (rate, channels, samples, packet.pts.get().max(0) as u64);
        };
        if rate == 0 || !(1..=32).contains(&channels) {
            return Err("unsupported audio format".into());
        }
        let frames = duration
            .map(|n| to_frames(n.get(), time_base, rate))
            .transpose()?;
        let edit = if let Some(ref mp4) = mp4 {
            // Reuse the indexed source instead of opening/inflating a second one.
            let mut stream = format.into_inner();
            let edit = read_edit(&mut stream, mp4, ordinal as u32, time_base, rate, frames)?;
            stream.seek(SeekFrom::Start(0))?;
            format = symphonia::default::get_probe().probe(
                &hint,
                stream,
                FormatOptions::default(),
                metadata_options,
            )?;
            edit
        } else {
            Edit {
                start: to_frames(start_ts.get().max(0) as u64, time_base, rate)?,
                silence: 0,
                frames,
            }
        };
        let packet_start = to_frames(packet_ts, time_base, rate)?;
        let mut result = Self {
            format,
            decoder,
            params,
            time_base,
            track: id,
            rate,
            channels,
            edit,
            cursor: 0,
            packet,
            packet_start,
            cancel,
            ended: false,
        };
        if mp4.is_some() {
            result.seek(0.0)?;
        }
        Ok(result)
    }
    pub(crate) fn sample_rate(&self) -> u32 {
        self.rate
    }
    pub(crate) fn channels(&self) -> usize {
        self.channels
    }
    /// Position of the next returned frame on the presentation timeline.
    pub(crate) fn position_seconds(&self) -> f64 {
        self.cursor as f64 / f64::from(self.rate)
    }
    /// Zero until EOF when the container does not advertise a duration.
    pub(crate) fn duration_seconds(&self) -> f64 {
        self.edit.frames.unwrap_or(0) as f64 / f64::from(self.rate)
    }
    pub(crate) fn set_cancel(&mut self, token: Arc<AtomicBool>) {
        self.cancel.set(token);
    }
    pub(crate) fn seek(&mut self, seconds: f64) -> Result<(), String> {
        self.cancel.check().map_err(|e| e.to_string())?;
        if !seconds.is_finite() || seconds < 0.0 {
            return Err("invalid audio seek time".into());
        }
        let requested = seconds * f64::from(self.rate);
        if requested >= u64::MAX as f64 {
            return Err("audio seek time overflow".into());
        }
        // Times are rounded to the closest representable sample frame.
        let mut target = requested.round() as u64;
        if let Some(frames) = self.edit.frames {
            target = target.min(frames);
        }
        let media = target
            .saturating_sub(self.edit.silence)
            .checked_add(self.edit.start)
            .ok_or("audio seek overflow")?;
        let preroll = media.saturating_sub(4096);
        let tb = self.time_base;
        let ts = i64::try_from(
            u128::from(preroll) * u128::from(tb.denom.get())
                / (u128::from(self.rate) * u128::from(tb.numer.get())),
        )
        .map_err(|_| "audio seek overflow")?;
        if self.edit.frames != Some(target) {
            self.format
                .seek(
                    SeekMode::Accurate,
                    SeekTo::Timestamp {
                        ts: Timestamp::new(ts),
                        track_id: self.track,
                    },
                )
                .map_err(|e| e.to_string())?;
            self.decoder = make_decoder(&self.params)?;
        }
        self.packet.clear();
        self.cursor = target;
        self.ended = false;
        Ok(())
    }
    fn next_packet(&mut self) -> Result<bool, String> {
        loop {
            self.cancel.check().map_err(|e| e.to_string())?;
            let packet = match self.format.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => {
                    if self.edit.frames.is_some_and(|frames| self.cursor < frames) {
                        return Err("audio ended before its declared duration".into());
                    }
                    self.edit.frames = Some(self.cursor);
                    self.ended = true;
                    return Ok(false);
                }
                Err(error) => return Err(error.to_string()),
            };
            if packet.track_id != self.track {
                continue;
            }
            let audio = self.decoder.decode(&packet).map_err(|e| e.to_string())?;
            if audio.spec().rate() != self.rate || audio.spec().channels().count() != self.channels
            {
                return Err("audio format changed during playback".into());
            }
            audio.copy_to_vec_interleaved(&mut self.packet);
            self.packet_start =
                to_frames(packet.pts.get().max(0) as u64, self.time_base, self.rate)?;
            if !self.packet.is_empty() {
                return Ok(true);
            }
        }
    }
    pub(crate) fn next_samples(&mut self) -> Result<Option<Vec<f32>>, String> {
        self.cancel.check().map_err(|e| e.to_string())?;
        if self.ended || self.edit.frames.is_some_and(|n| self.cursor >= n) {
            return Ok(None);
        }
        if self.cursor < self.edit.silence {
            let count = (self.edit.silence - self.cursor)
                .min(4096)
                .min(self.edit.frames.unwrap_or(u64::MAX) - self.cursor);
            self.cursor += count;
            return Ok(Some(vec![0.0; count as usize * self.channels]));
        }
        let target = self.cursor - self.edit.silence + self.edit.start;
        loop {
            let frames = self.packet.len() as u64 / self.channels as u64;
            if frames > 0 && self.packet_start <= target && target - self.packet_start < frames {
                break;
            }
            if frames > 0 && self.packet_start > target {
                return Err("gap in audio packet timestamps".into());
            }
            if !self.next_packet()? {
                return Ok(None);
            }
        }
        let begin = (target - self.packet_start) as usize * self.channels;
        let count = ((self.packet.len() - begin) / self.channels) as u64;
        let count = count.min(self.edit.frames.unwrap_or(u64::MAX) - self.cursor);
        let samples = self.packet[begin..begin + count as usize * self.channels].to_vec();
        self.cursor += count;
        Ok(Some(samples))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    const AAC: &[u8] =
        include_bytes!("../../../../../src/__tests__/fixtures/data/audiobook/chapters-leading.m4b");
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(bytes: &[u8], extension: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "readest-decoder-{}-{}.{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed),
                extension
            ));
            fs::write(&path, bytes).unwrap();
            Self(path)
        }
        fn decoder(&self) -> AudioDecoder {
            AudioDecoder::open(self.0.clone(), None, None, None).unwrap()
        }
        fn zip(bytes: &[u8], method: zip::CompressionMethod) -> Self {
            let fixture = Self::new(&[], "epub");
            let mut writer = zip::ZipWriter::new(File::create(&fixture.0).unwrap());
            writer
                .start_file(
                    "audio.m4a",
                    zip::write::SimpleFileOptions::default().compression_method(method),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
            writer.finish().unwrap();
            fixture
        }
    }
    use std::fs::File;
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    fn all(decoder: &mut AudioDecoder) -> Vec<f32> {
        let mut result = Vec::new();
        while let Some(samples) = decoder.next_samples().unwrap() {
            assert!(!samples.is_empty());
            result.extend(samples);
        }
        result
    }
    #[test]
    fn local_window_stored_and_deflated_decode_identically() {
        let local = Fixture::new(AAC, "m4a");
        let mut decoder = local.decoder();
        let expected = all(&mut decoder);
        assert_eq!(expected.len(), 441_344);
        assert!(expected.iter().any(|n| n.abs() > 0.01));
        for method in [
            zip::CompressionMethod::Stored,
            zip::CompressionMethod::Deflated,
        ] {
            let fixture = Fixture::zip(AAC, method);
            let mut decoder =
                AudioDecoder::open(fixture.0.clone(), None, None, Some("audio.m4a".into()))
                    .unwrap();
            assert_eq!(all(&mut decoder), expected);
        }
        let mut bytes = vec![13; 997];
        bytes.extend_from_slice(AAC);
        bytes.extend_from_slice(&[19; 519]);
        let fixture = Fixture::new(&bytes, "epub");
        let mut decoder = AudioDecoder::open(
            fixture.0.clone(),
            Some(997),
            Some(997 + AAC.len() as u64),
            None,
        )
        .unwrap();
        assert_eq!(all(&mut decoder), expected);
    }
    #[test]
    fn seek_returns_requested_sample_and_filters_chapter_packets() {
        let fixture = Fixture::new(AAC, "m4a");
        let mut decoder = fixture.decoder();
        let expected = all(&mut decoder);
        for frame in [131_117, 0, 440_999, 30_003, 65_537, 440_000, 0] {
            decoder.seek(frame as f64 / 44100.0).unwrap();
            assert_eq!(decoder.position_seconds(), frame as f64 / 44100.0);
            let got = decoder.next_samples().unwrap().unwrap();
            assert_eq!(
                got,
                expected[frame..frame + got.len()],
                "first returned sample must match target {frame}"
            );
        }
        decoder.seek(decoder.duration_seconds()).unwrap();
        assert!(decoder.next_samples().unwrap().is_none());
        assert!(decoder.seek(f64::NAN).is_err());
        assert!(decoder.seek(-1.0).is_err());
    }
    #[test]
    fn edit_list_priming_is_trimmed_and_end_is_exact() {
        let original = Fixture::new(AAC, "m4a");
        let expected = all(&mut original.decoder());
        let mut bytes = AAC.to_vec();
        let elst = bytes.windows(4).position(|w| w == b"elst").unwrap();
        bytes[elst + 16..elst + 20].copy_from_slice(&1024i32.to_be_bytes());
        let trimmed = Fixture::zip(&bytes, zip::CompressionMethod::Deflated);
        let mut decoder =
            AudioDecoder::open(trimmed.0.clone(), None, None, Some("audio.m4a".into())).unwrap();
        assert_eq!(all(&mut decoder), expected[1024..]);
        decoder.seek(100_003.0 / 44100.0).unwrap();
        let got = decoder.next_samples().unwrap().unwrap();
        assert_eq!(got, expected[101_027..101_027 + got.len()]);
    }
    #[test]
    fn empty_edit_inserts_silence_before_trimmed_media() {
        let original = Fixture::new(AAC, "m4a");
        let expected = all(&mut original.decoder());
        let mut bytes = AAC.to_vec();
        let elst = bytes.windows(4).position(|w| w == b"elst").unwrap();
        let ancestors: Vec<usize> = [b"moov", b"trak", b"edts", b"elst"]
            .iter()
            .map(|kind| bytes.windows(4).position(|w| w == *kind).unwrap() - 4)
            .collect();
        for pos in ancestors {
            let size = u32::from_be_bytes(bytes[pos..pos + 4].try_into().unwrap()) + 12;
            bytes[pos..pos + 4].copy_from_slice(&size.to_be_bytes());
        }
        bytes[elst + 8..elst + 12].copy_from_slice(&2u32.to_be_bytes());
        let mut empty = Vec::new();
        empty.extend_from_slice(&1000u32.to_be_bytes());
        empty.extend_from_slice(&(-1i32).to_be_bytes());
        empty.extend_from_slice(&0x10000u32.to_be_bytes());
        bytes.splice(elst + 12..elst + 12, empty);
        // Insertion shifts absolute chunk offsets in every track.
        let mut pos = 0;
        while let Some(relative) = bytes[pos..].windows(4).position(|w| w == b"stco") {
            let atom = pos + relative;
            let count = u32::from_be_bytes(bytes[atom + 8..atom + 12].try_into().unwrap()) as usize;
            for index in 0..count {
                let offset = atom + 12 + index * 4;
                let old = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap());
                bytes[offset..offset + 4].copy_from_slice(&(old + 12).to_be_bytes());
            }
            pos = atom + 4;
        }
        let fixture = Fixture::new(&bytes, "m4a");
        let mut decoder = fixture.decoder();
        let got = all(&mut decoder);
        assert_eq!(got.len(), expected.len() + 44100);
        assert!(got[..44100].iter().all(|n| *n == 0.0));
        assert_eq!(&got[44100..], expected);
        decoder.seek(0.5).unwrap();
        let silence = decoder.next_samples().unwrap().unwrap();
        assert!(silence.iter().all(|n| *n == 0.0));
        decoder.seek(1.0 + 10003.0 / 44100.0).unwrap();
        let got = decoder.next_samples().unwrap().unwrap();
        assert_eq!(got, expected[10003..10003 + got.len()]);
    }
    #[test]
    fn excessive_mp4_table_count_is_rejected_before_allocation() {
        let mut bytes = AAC.to_vec();
        let stsz = bytes.windows(4).position(|w| w == b"stsz").unwrap();
        bytes[stsz + 12..stsz + 16].copy_from_slice(&u32::MAX.to_be_bytes());
        let fixture = Fixture::new(&bytes, "m4a");
        let error = AudioDecoder::open(fixture.0.clone(), None, None, None)
            .err()
            .expect("malformed count must fail");
        assert!(error.contains("metadata limits"), "{error}");
    }
    #[test]
    fn stereo_pcm_preserves_interleaving_and_seek_frame() {
        let rate = 48000u32;
        let frames = 10000u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + frames * 4).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(frames * 4).to_le_bytes());
        for n in 0..frames {
            bytes.extend_from_slice(&(n as i16).to_le_bytes());
            bytes.extend_from_slice(&(-(n as i16)).to_le_bytes());
        }
        let fixture = Fixture::new(&bytes, "wav");
        let mut decoder = fixture.decoder();
        assert_eq!(decoder.channels(), 2);
        assert_eq!(decoder.sample_rate(), rate);
        let samples = all(&mut decoder);
        assert_eq!(samples.len(), frames as usize * 2);
        for n in [1usize, 713, 9700] {
            assert_eq!(samples[n * 2], n as f32 / 32768.0);
            assert_eq!(samples[n * 2 + 1], -(n as f32) / 32768.0);
        }
        decoder.seek(713.0 / f64::from(rate)).unwrap();
        let got = decoder.next_samples().unwrap().unwrap();
        assert_eq!(got, samples[1426..1426 + got.len()]);
    }
    #[test]
    fn malformed_aac_packet_error_is_not_skipped() {
        let mut bytes = AAC.to_vec();
        let mdat = bytes.windows(4).position(|w| w == b"mdat").unwrap();
        bytes[mdat + 4..].fill(0x40);
        let fixture = Fixture::new(&bytes, "m4a");
        let error = AudioDecoder::open(fixture.0.clone(), None, None, None)
            .err()
            .expect("corrupt AAC must report a decode error");
        assert!(error.contains("aac") || error.contains("stream"), "{error}");
    }
    #[test]
    fn cancellation_replacement_and_decode_errors_are_observable() {
        let fixture = Fixture::new(AAC, "m4a");
        let mut decoder = fixture.decoder();
        let token = Arc::new(AtomicBool::new(true));
        decoder.set_cancel(token);
        assert!(decoder.next_samples().unwrap_err().contains("cancelled"));
        assert!(decoder.seek(1.0).unwrap_err().contains("cancelled"));
        decoder.set_cancel(Arc::new(AtomicBool::new(false)));
        decoder.seek(1.0).unwrap();
        assert!(!decoder.next_samples().unwrap().unwrap().is_empty());
        assert!(AudioDecoder::open(fixture.0.clone(), None, None, None).is_ok());
        let malformed = Fixture::new(b"invalid audio", "m4a");
        assert!(AudioDecoder::open(malformed.0.clone(), None, None, None).is_err());
    }
}
