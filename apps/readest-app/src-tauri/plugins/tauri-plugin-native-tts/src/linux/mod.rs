//! Local narration playback independent of the WebView's codec support.
mod decoder;
mod output;
mod zip_source;

use crate::models::{PlayoutControlRequest, PlayoutControlResponse, PlayoutPositionResponse};
use crate::now_playing::{self, Listeners};
use decoder::AudioDecoder;
use output::Output;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) type PendingReply = mpsc::Receiver<Result<PlayoutControlResponse, String>>;
type Reply = mpsc::SyncSender<Result<PlayoutControlResponse, String>>;
struct Command {
    request: PlayoutControlRequest,
    cancel: Arc<AtomicBool>,
    reply: Reply,
}

pub(crate) struct Player {
    sender: mpsc::Sender<Command>,
    cancel: Mutex<Arc<AtomicBool>>,
    position: Arc<Mutex<PlayoutPositionResponse>>,
}
impl Player {
    pub(crate) fn new(listeners: Listeners) -> Self {
        let (sender, receiver) = mpsc::channel();
        let position = Arc::new(Mutex::new(PlayoutPositionResponse {
            session: 0,
            index: -1,
            position_ms: 0.,
            playing: false,
            ended_index: None,
        }));
        let snapshot = position.clone();
        std::thread::spawn(move || {
            Worker {
                decoder: None,
                output: None,
                pending: Vec::new(),
                pending_offset: 0,
                session: 0,
                rate: 1.,
                playing: false,
                finished: false,
                listeners,
                position: snapshot,
            }
            .run(receiver)
        });
        Self {
            sender,
            cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            position,
        }
    }
    pub(crate) fn enqueue<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        request: PlayoutControlRequest,
    ) -> crate::Result<PendingReply> {
        if request.action == "load" {
            let path = PathBuf::from(request.path.as_deref().unwrap_or(""));
            if !path.is_absolute()
                || path.to_string_lossy().contains('\0')
                || path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                || !app.asset_protocol_scope().is_allowed(&path)
            {
                return Err(crate::Error::NativeTTSError(
                    "Narration path not allowed".into(),
                ));
            }
        }
        let (reply, result) = mpsc::sync_channel(1);
        {
            // Cancel replaced sources immediately, while preserving the ordered
            // pause/resume/seek/rate commands for the source being loaded.
            let mut token = self.cancel.lock().unwrap();
            let cancel = command_token(&mut token, &request.action);
            self.sender
                .send(Command {
                    request,
                    cancel,
                    reply,
                })
                .map_err(|e| crate::Error::NativeTTSError(e.to_string()))?;
        }
        Ok(result)
    }
    pub(crate) fn position(&self) -> PlayoutPositionResponse {
        let p = self.position.lock().unwrap();
        PlayoutPositionResponse {
            session: p.session,
            index: p.index,
            position_ms: p.position_ms,
            playing: p.playing,
            ended_index: p.ended_index,
        }
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        self.cancel.lock().unwrap().store(true, Ordering::Relaxed);
    }
}
struct Worker {
    decoder: Option<AudioDecoder>,
    output: Option<Output>,
    pending: Vec<f32>,
    pending_offset: usize,
    session: i32,
    rate: f64,
    playing: bool,
    finished: bool,
    listeners: Listeners,
    position: Arc<Mutex<PlayoutPositionResponse>>,
}
impl Worker {
    fn emit(&self, kind: &str, message: Option<&str>) {
        now_playing::emit(
            &self.listeners,
            "playout_events",
            serde_json::json!({"type": kind, "session": self.session, "index": 0, "message": message}),
        );
    }
    fn run(mut self, receiver: mpsc::Receiver<Command>) {
        let mut active = Arc::new(AtomicBool::new(false));
        loop {
            let filling = !active.load(Ordering::Relaxed)
                && !self.finished
                && self.output.as_ref().is_some_and(Output::needs_samples);
            match receiver.recv_timeout(Duration::from_millis(if filling { 0 } else { 10 })) {
                Ok(command) => {
                    active = command.cancel.clone();
                    let result = self.control(command.request, &command.cancel);
                    if result.is_err() && !command.cancel.load(Ordering::Relaxed) {
                        self.clear();
                    }
                    self.publish();
                    let _ = command.reply.send(result.map(|()| PlayoutControlResponse {
                        session: Some(self.session),
                    }));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if active.load(Ordering::Relaxed) {
                continue;
            }
            if let Err(error) = self.fill() {
                if active.load(Ordering::Relaxed) {
                    continue;
                }
                self.clear();
                self.publish();
                self.emit("error", Some(&error));
            }
            self.publish();
        }
    }
    fn clear(&mut self) {
        self.output = None;
        self.decoder = None;
        self.pending.clear();
        self.pending_offset = 0;
        self.playing = false;
        self.finished = false;
    }
    fn control(
        &mut self,
        request: PlayoutControlRequest,
        cancel: &Arc<AtomicBool>,
    ) -> Result<(), String> {
        if cancel.load(Ordering::Relaxed) {
            return Err("Narration operation cancelled".into());
        }
        match request.action.as_str() {
            "start-session" => {
                self.clear();
                self.session = self.session.wrapping_add(1);
            }
            "abort" => self.clear(),
            "load" => {
                self.output = None;
                self.decoder = None;
                self.pending.clear();
                self.pending_offset = 0;
                self.finished = false;
                let mut decoder = AudioDecoder::open_with_cancel(
                    PathBuf::from(request.path.ok_or("Missing narration path")?),
                    request.start,
                    request.end,
                    request.entry,
                    cancel.clone(),
                )?;
                let seconds = seconds(request.position_ms)?;
                if seconds > 0. {
                    decoder.seek(seconds)?;
                }
                let position = decoder.position_seconds();
                let output = Output::new(
                    decoder.sample_rate(),
                    decoder.channels(),
                    position,
                    self.rate,
                )?;
                if cancel.load(Ordering::Relaxed) {
                    return Err("Narration operation cancelled".into());
                }
                self.decoder = Some(decoder);
                output.set_playing(self.playing);
                self.output = Some(output);
            }
            "seek" | "set-rate" => {
                let position = if request.action == "seek" {
                    seconds(request.position_ms)?
                } else {
                    let rate = request.rate.ok_or("Missing narration rate")?;
                    if !rate.is_finite() || !(0.25..=4.).contains(&rate) {
                        return Err("Invalid narration rate".into());
                    }
                    if self.rate == rate {
                        return Ok(());
                    }
                    self.rate = rate;
                    self.output.as_ref().map_or(0., |o| o.position().0)
                };
                if let Some(decoder) = &mut self.decoder {
                    // Closing the stream discards frames already submitted to
                    // the device; clearing only the software queue cannot do that.
                    self.output = None;
                    decoder.set_cancel(cancel.clone());
                    decoder.seek(position)?;
                    if cancel.load(Ordering::Relaxed) {
                        return Err("Narration operation cancelled".into());
                    }
                    let output = Output::new(
                        decoder.sample_rate(),
                        decoder.channels(),
                        decoder.position_seconds(),
                        self.rate,
                    )?;
                    if cancel.load(Ordering::Relaxed) {
                        return Err("Narration operation cancelled".into());
                    }
                    output.set_playing(self.playing);
                    self.output = Some(output);
                    self.pending.clear();
                    self.pending_offset = 0;
                    self.finished = false;
                }
            }
            "pause" | "resume" => {
                self.playing = request.action == "resume";
                if let Some(output) = &self.output {
                    output.set_playing(self.playing);
                }
            }
            _ => return Err("Unsupported narration action".into()),
        }
        Ok(())
    }
    fn fill(&mut self) -> Result<(), String> {
        if let (Some(output), Some(decoder)) = (&mut self.output, &mut self.decoder) {
            if let Some(error) = output.error() {
                return Err(error);
            }
            output.pump();
            if !self.finished && output.needs_samples() {
                if self.pending_offset == self.pending.len() {
                    match decoder.next_samples()? {
                        Some(samples) => {
                            self.pending = samples;
                            self.pending_offset = 0;
                        }
                        None => {
                            output.finish();
                            self.finished = true;
                        }
                    }
                }
                if !self.finished {
                    self.pending_offset += output.push(&self.pending[self.pending_offset..]);
                }
            }
        }
        Ok(())
    }
    fn publish(&mut self) {
        let mut snapshot = self.position.lock().unwrap();
        snapshot.session = self.session;
        if let Some(output) = &self.output {
            let (seconds, playing, ended) = output.position();
            let duration = self
                .decoder
                .as_ref()
                .map_or(seconds, AudioDecoder::duration_seconds);
            snapshot.position_ms = if duration > 0. {
                seconds.min(duration)
            } else {
                seconds
            } * 1000.;
            snapshot.playing = playing;
            snapshot.index = if ended { -1 } else { 0 };
            snapshot.ended_index = ended.then_some(0);
            if ended && self.playing {
                self.playing = false;
                drop(snapshot);
                self.emit("ended", None);
            }
        } else {
            snapshot.index = -1;
            snapshot.playing = false;
            snapshot.position_ms = 0.;
            snapshot.ended_index = None;
        }
    }
}
fn command_token(current: &mut Arc<AtomicBool>, action: &str) -> Arc<AtomicBool> {
    if matches!(action, "load" | "abort" | "start-session") {
        current.store(true, Ordering::Relaxed);
        *current = Arc::new(AtomicBool::new(false));
    }
    current.clone()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_transport_controls_preserve_the_pending_load() {
        let mut current = Arc::new(AtomicBool::new(false));
        let load = command_token(&mut current, "load");
        for action in ["seek", "set-rate", "resume", "pause"] {
            let next = command_token(&mut current, action);
            assert!(
                !load.load(Ordering::Relaxed),
                "{action} cancelled the pending audio load"
            );
            assert!(Arc::ptr_eq(&load, &next));
        }
        for action in ["load", "abort", "start-session"] {
            let previous = current.clone();
            let next = command_token(&mut current, action);
            assert!(previous.load(Ordering::Relaxed));
            assert!(!next.load(Ordering::Relaxed));
        }
    }
}
fn seconds(milliseconds: Option<f64>) -> Result<f64, String> {
    let milliseconds = milliseconds.unwrap_or(0.);
    if !milliseconds.is_finite() || milliseconds < 0. {
        return Err("Invalid narration position".into());
    }
    Ok(milliseconds / 1000.)
}
