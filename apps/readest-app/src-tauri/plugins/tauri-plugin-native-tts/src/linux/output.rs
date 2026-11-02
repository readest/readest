//! Bounded PCM output and an audio-device presentation clock.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use soundtouch::SoundTouch;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Scheduled {
    start: Instant,
    end: Instant,
    media_start: f64,
    media_end: f64,
}
struct PcmQueue {
    samples: VecDeque<f32>,
    channels: usize,
    sample_rate: u32,
    rate: f64,
    position: f64,
    submitted: f64,
    scheduled: VecDeque<Scheduled>,
    paused_at: Option<Instant>,
    playing: bool,
    ended: bool,
}
impl PcmQueue {
    fn new(channels: usize, sample_rate: u32, position: f64, rate: f64) -> Self {
        Self {
            samples: VecDeque::with_capacity(sample_rate as usize * channels / 4),
            channels,
            sample_rate,
            rate,
            position,
            submitted: position,
            scheduled: VecDeque::with_capacity(64),
            paused_at: None,
            playing: false,
            ended: false,
        }
    }
    fn advance(&mut self, now: Instant) {
        if !self.playing {
            return;
        }
        while let Some(segment) = self.scheduled.front() {
            if now >= segment.end {
                self.position = segment.media_end;
                self.scheduled.pop_front();
            } else {
                if now > segment.start {
                    let fraction = now.duration_since(segment.start).as_secs_f64()
                        / segment.end.duration_since(segment.start).as_secs_f64();
                    self.position =
                        segment.media_start + (segment.media_end - segment.media_start) * fraction;
                }
                break;
            }
        }
    }
    fn set_playing(&mut self, playing: bool, now: Instant) {
        self.advance(now);
        if self.playing && !playing {
            self.paused_at = Some(now);
        }
        if !self.playing && playing {
            if let Some(paused) = self.paused_at.take() {
                let elapsed = now.saturating_duration_since(paused);
                for segment in &mut self.scheduled {
                    segment.start += elapsed;
                    segment.end += elapsed;
                }
            }
        }
        self.playing = playing;
    }
    fn position(&mut self, now: Instant) -> (f64, bool, bool) {
        self.advance(now);
        let ended = self.ended && self.samples.is_empty() && self.scheduled.is_empty();
        let audible = self
            .scheduled
            .front()
            .is_some_and(|s| now >= s.start && now < s.end);
        (self.position, self.playing && audible && !ended, ended)
    }
    fn render(&mut self, out: &mut [f32], now: Instant, playback: Instant) {
        out.fill(0.0);
        self.advance(now);
        if !self.playing {
            return;
        }
        let count = out.len().min(self.samples.len()) / self.channels * self.channels;
        if count == 0 || self.scheduled.len() == 64 {
            return;
        }
        for sample in &mut out[..count] {
            *sample = self.samples.pop_front().unwrap();
        }
        let duration =
            Duration::from_secs_f64(count as f64 / self.channels as f64 / self.sample_rate as f64);
        let end = playback + duration;
        let media_start = self.submitted;
        self.submitted += duration.as_secs_f64() * self.rate;
        self.scheduled.push_back(Scheduled {
            start: playback,
            end,
            media_start,
            media_end: self.submitted,
        });
    }
    fn capacity(&self) -> usize {
        self.sample_rate as usize * self.channels / 4
    }
}

// This part is device independent so queue bounds can be verified without ALSA.
struct Processor {
    stretch: SoundTouch,
    input_channels: usize,
    channels: usize,
    input_rate: u32,
    output_rate: u32,
    rate: f64,
    finished: bool,
}
impl Processor {
    fn new(
        input_rate: u32,
        input_channels: usize,
        output_rate: u32,
        channels: usize,
        rate: f64,
    ) -> Self {
        let mut stretch = SoundTouch::new();
        stretch
            .set_channels(channels as u32)
            .set_sample_rate(output_rate)
            .set_rate(input_rate as f64 / output_rate as f64)
            .set_tempo(rate);
        Self {
            stretch,
            input_channels,
            channels,
            input_rate,
            output_rate,
            rate,
            finished: false,
        }
    }
    fn pump(&mut self, queue: &mut PcmQueue) {
        let mut samples = [0.; 8192];
        loop {
            let capacity = queue.capacity().saturating_sub(queue.samples.len()) / self.channels;
            let frames = capacity.min(samples.len() / self.channels);
            if frames == 0 {
                break;
            }
            let count = self.stretch.receive_samples(&mut samples, frames) * self.channels;
            if count == 0 {
                break;
            }
            queue.samples.extend(&samples[..count]);
        }
        queue.ended = self.finished && self.stretch.num_samples() == 0;
    }
    fn push(&mut self, samples: &[f32], queue: &mut PcmQueue) -> usize {
        self.pump(queue);
        if self.finished
            || queue.samples.len() >= queue.capacity()
            || self.stretch.num_samples() > 0
        {
            return 0;
        }
        // A low-rate source at slow tempo can expand drastically; bound each
        // feed by its expected output length, rather than the codec packet size.
        let frames = ((1024. * self.input_rate as f64 * self.rate / self.output_rate as f64)
            as usize)
            .clamp(1, 1024)
            .min(samples.len() / self.input_channels);
        if frames == 0 {
            return 0;
        }
        let count = frames * self.input_channels;
        let mapped = map_channels(&samples[..count], self.input_channels, self.channels);
        self.stretch.put_samples(&mapped, frames);
        self.pump(queue);
        count
    }
    fn finish(&mut self, queue: &mut PcmQueue) {
        if !self.finished {
            self.stretch.flush();
            self.finished = true;
        }
        self.pump(queue);
    }
}

pub(super) struct Output {
    stream: cpal::Stream,
    queue: Arc<Mutex<PcmQueue>>,
    error: Arc<Mutex<Option<String>>>,
    processor: Processor,
}
impl Output {
    pub(super) fn new(
        sample_rate: u32,
        channels: usize,
        position: f64,
        rate: f64,
    ) -> Result<Self, String> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or("No audio output device")?;
        let supported = device
            .supported_output_configs()
            .map_err(|e| e.to_string())?
            .filter(|c| {
                matches!(c.channels(), 1 | 2)
                    && matches!(
                        c.sample_format(),
                        cpal::SampleFormat::F32 | cpal::SampleFormat::I16 | cpal::SampleFormat::U16
                    )
            })
            .min_by_key(|c| {
                (
                    u8::from(c.channels() as usize != channels),
                    u8::from(
                        sample_rate < c.min_sample_rate().0 || sample_rate > c.max_sample_rate().0,
                    ),
                    u8::from(c.sample_format() != cpal::SampleFormat::F32),
                )
            })
            .ok_or("No supported mono or stereo audio output")?;
        let device_rate =
            sample_rate.clamp(supported.min_sample_rate().0, supported.max_sample_rate().0);
        let config = supported.with_sample_rate(cpal::SampleRate(device_rate));
        let output_channels = config.channels() as usize;
        let queue = Arc::new(Mutex::new(PcmQueue::new(
            output_channels,
            device_rate,
            position,
            rate,
        )));
        let error = Arc::new(Mutex::new(None));
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                build_stream::<f32>(&device, &config.config(), queue.clone(), error.clone())
            }
            cpal::SampleFormat::I16 => {
                build_stream::<i16>(&device, &config.config(), queue.clone(), error.clone())
            }
            cpal::SampleFormat::U16 => {
                build_stream::<u16>(&device, &config.config(), queue.clone(), error.clone())
            }
            _ => unreachable!(),
        }?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self {
            stream,
            queue,
            error,
            processor: Processor::new(sample_rate, channels, device_rate, output_channels, rate),
        })
    }
    pub(super) fn position(&self) -> (f64, bool, bool) {
        self.queue.lock().unwrap().position(Instant::now())
    }
    pub(super) fn set_playing(&self, playing: bool) {
        if !playing {
            if let Err(error) = self.stream.pause() {
                *self.error.lock().unwrap() = Some(error.to_string());
            }
        }
        self.queue
            .lock()
            .unwrap()
            .set_playing(playing, Instant::now());
        if playing {
            if let Err(error) = self.stream.play() {
                *self.error.lock().unwrap() = Some(error.to_string());
            }
        }
    }
    pub(super) fn needs_samples(&self) -> bool {
        let queue = self.queue.lock().unwrap();
        queue.samples.len() < queue.capacity()
    }
    /// Accept a bounded prefix; the worker retains the rest of the codec packet.
    pub(super) fn push(&mut self, samples: &[f32]) -> usize {
        self.processor
            .push(samples, &mut self.queue.lock().unwrap())
    }
    /// Also call after input EOF: SoundTouch may still have pending output.
    pub(super) fn pump(&mut self) {
        self.processor.pump(&mut self.queue.lock().unwrap());
    }
    pub(super) fn finish(&mut self) {
        self.processor.finish(&mut self.queue.lock().unwrap());
    }
    pub(super) fn error(&self) -> Option<String> {
        self.error.lock().unwrap().take()
    }
}
fn map_channels(samples: &[f32], input: usize, output: usize) -> Vec<f32> {
    if input == output {
        return samples.to_vec();
    }
    samples
        .chunks_exact(input)
        .flat_map(|frame| {
            let mono = frame.iter().sum::<f32>() / input as f32;
            if output == 1 {
                vec![mono]
            } else if input == 1 {
                vec![mono, mono]
            } else {
                vec![frame[0], frame[1]]
            }
        })
        .collect()
}
fn build_stream<T: cpal::SizedSample + cpal::FromSample<f32>>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<PcmQueue>>,
    error: Arc<Mutex<Option<String>>>,
) -> Result<cpal::Stream, String> {
    device
        .build_output_stream(
            config,
            move |out: &mut [T], info| {
                out.fill(T::from_sample(0.));
                if let Ok(mut queue) = queue.try_lock() {
                    let now = Instant::now();
                    let timestamp = info.timestamp();
                    let latency = timestamp
                        .playback
                        .duration_since(&timestamp.callback)
                        .unwrap_or_default();
                    let playback = now + latency;
                    let mut buffer = [0.; 1024];
                    let chunk_size = buffer.len() / queue.channels * queue.channels;
                    for (index, chunk) in out.chunks_mut(chunk_size).enumerate() {
                        let offset = Duration::from_secs_f64(
                            (index * chunk_size) as f64
                                / queue.channels as f64
                                / queue.sample_rate as f64,
                        );
                        queue.render(&mut buffer[..chunk.len()], now, playback + offset);
                        for (sample, value) in chunk.iter_mut().zip(&buffer) {
                            *sample = T::from_sample(*value);
                        }
                    }
                }
            },
            move |e| {
                *error.lock().unwrap() = Some(e.to_string());
            },
            None,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn queue() -> PcmQueue {
        let mut queue = PcmQueue::new(2, 100, 3., 1.5);
        queue.playing = true;
        queue
    }
    #[test]
    fn clock_advances_only_as_scheduled_frames_play_and_freezes_on_underrun() {
        let now = Instant::now();
        let mut queue = queue();
        queue.samples.extend([0.25; 20]);
        let mut out = [0.; 40];
        queue.render(&mut out, now, now);
        assert_eq!(&out[..20], &[0.25; 20]);
        assert_eq!(&out[20..], &[0.; 20]);
        assert_eq!(queue.position(now).0, 3.);
        assert!((queue.position(now + Duration::from_millis(50)).0 - 3.075).abs() < 1e-9);
        assert!((queue.position(now + Duration::from_secs(1)).0 - 3.15).abs() < 1e-9);
        assert!((queue.position(now + Duration::from_secs(2)).0 - 3.15).abs() < 1e-9);
    }
    #[test]
    fn clock_and_end_wait_for_scheduled_device_playback() {
        let now = Instant::now();
        let playback = now + Duration::from_millis(75);
        let mut queue = queue();
        queue.samples.extend([0.5; 20]);
        queue.ended = true;
        let mut out = [0.; 20];
        queue.render(&mut out, now, playback);
        assert_eq!(queue.position(now), (3., false, false));
        assert_eq!(queue.position(playback), (3., true, false));
        assert_eq!(
            queue.position(playback + Duration::from_millis(100)),
            (3.15, false, true)
        );
    }
    #[test]
    fn playing_flag_freezes_frontend_on_initial_fill_and_underrun() {
        let now = Instant::now();
        let mut queue = queue();
        assert!(!queue.position(now).1);
        queue.samples.extend([0.5; 20]);
        queue.render(&mut [0.; 20], now, now + Duration::from_millis(75));
        assert!(!queue.position(now + Duration::from_millis(74)).1);
        assert!(queue.position(now + Duration::from_millis(80)).1);
        assert!(!queue.position(now + Duration::from_millis(200)).1);
    }
    #[test]
    fn scheduled_timeline_stays_bounded_on_device_callbacks() {
        let now = Instant::now();
        let mut queue = queue();
        for _ in 0..1000 {
            queue.samples.extend([0.5; 2]);
            queue.render(&mut [0.; 2], now, now + Duration::from_secs(1));
        }
        assert_eq!(queue.scheduled.len(), 64);
    }
    #[test]
    fn pause_freezes_clock_and_resume_shifts_scheduled_frames() {
        let now = Instant::now();
        let mut queue = queue();
        queue.samples.extend([0.5; 40]);
        queue.render(&mut [0.; 20], now, now);
        queue.set_playing(false, now + Duration::from_millis(50));
        assert!((queue.position(now + Duration::from_secs(5)).0 - 3.075).abs() < 1e-9);
        queue.render(
            &mut [0.; 20],
            now + Duration::from_secs(5),
            now + Duration::from_secs(5),
        );
        assert_eq!(queue.samples.len(), 20);
        queue.set_playing(true, now + Duration::from_millis(1050));
        assert!((queue.position(now + Duration::from_millis(1075)).0 - 3.1125).abs() < 1e-9);
    }
    #[test]
    fn replacement_queue_discards_old_scheduled_timeline() {
        let now = Instant::now();
        let mut queue = queue();
        queue.samples.extend([0.5; 20]);
        queue.render(&mut [0.; 20], now, now + Duration::from_secs(1));
        queue = PcmQueue::new(2, 100, 20., 2.);
        assert_eq!(
            queue.position(now + Duration::from_secs(2)),
            (20., false, false)
        );
        assert!(queue.scheduled.is_empty());
    }
    #[test]
    fn large_low_rate_packet_has_bounded_output_at_slow_tempo() {
        let mut processor = Processor::new(8000, 2, 48000, 2, 0.25);
        let mut queue = PcmQueue::new(2, 48000, 0., 0.25);
        queue.playing = true;
        let input = vec![0.1; 65535 * 2];
        let mut cursor = 0;
        let mut total = 0;
        let mut peak = 0;
        let mut now = Instant::now();
        let mut finished = false;
        for _ in 0..100_000 {
            if cursor < input.len() {
                cursor += processor.push(&input[cursor..], &mut queue);
            } else if !finished {
                processor.finish(&mut queue);
                finished = true;
            }
            processor.pump(&mut queue);
            peak = peak.max(queue.samples.len());
            assert!(queue.samples.len() <= queue.capacity());
            assert!(
                processor.stretch.num_samples() < 48000,
                "SoundTouch output must also stay bounded"
            );
            let count = queue.samples.len().min(2048);
            total += count / 2;
            queue.render(&mut vec![0.; count], now, now);
            now += Duration::from_secs_f64(count as f64 / 96000.);
            if finished && queue.ended && queue.samples.is_empty() {
                break;
            }
        }
        assert_eq!(cursor, input.len());
        assert!(total > 1_500_000);
        assert!(peak <= 24000);
    }
    #[test]
    fn tempo_preserves_pitch_and_duration_at_different_device_sample_rates() {
        let source_rate = 44100;
        let output_rate = 48000;
        let source: Vec<f32> = (0..source_rate * 2)
            .map(|i| (i as f32 * 440. * std::f32::consts::TAU / source_rate as f32).sin() * 0.5)
            .collect();
        for tempo in [0.5, 1., 1.5, 3.] {
            let mut stretch = SoundTouch::new();
            stretch
                .set_channels(1)
                .set_sample_rate(output_rate)
                .set_rate(source_rate as f64 / output_rate as f64)
                .set_tempo(tempo);
            stretch.put_samples(&source, source.len());
            stretch.flush();
            let mut result = Vec::new();
            let mut buffer = [0.; 4096];
            loop {
                let count = stretch.receive_samples(&mut buffer, 4096);
                if count == 0 {
                    break;
                }
                result.extend_from_slice(&buffer[..count]);
            }
            let expected = 2. * output_rate as f64 / tempo;
            assert!(
                (result.len() as f64 - expected).abs() < output_rate as f64 * 0.03,
                "duration at {tempo}x: {}",
                result.len()
            );
            let middle = &result[result.len() / 4..result.len() * 3 / 4];
            let crossings = middle
                .windows(2)
                .filter(|p| p[0] <= 0. && p[1] > 0.)
                .count();
            let frequency = crossings as f64 * output_rate as f64 / middle.len() as f64;
            assert!(
                (frequency - 440.).abs() < 8.,
                "pitch at {tempo}x: {frequency}"
            );
        }
    }
}
