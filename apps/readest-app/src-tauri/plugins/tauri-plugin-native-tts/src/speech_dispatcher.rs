//! Linux local speech through Speech Dispatcher's SSIP Unix socket.
//! No libspeechd dependency: AppImage uses the host daemon, and Flatpak needs
//! --filesystem=xdg-run/speech-dispatcher:ro to reach the same socket.
use std::collections::HashSet;
use std::io::{self, BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(3);
// espeak-ng sends ~15k voice rows, 0.4 s on a fast desktop. Stays under the
// reader's 15 s engine init limit.
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
static CONNECTION_ID: AtomicU64 = AtomicU64::new(0);

type Emit = Arc<dyn Fn(Event) + Send + Sync>;

pub(crate) struct Event {
    pub utterance_id: String,
    pub code: &'static str,
    pub message: Option<String>,
}

pub(crate) struct Voice {
    pub id: String,
    pub name: String,
    pub lang: String,
    module: String,
    synthesis_voice: String,
}

struct Reply {
    code: u16,
    data: Vec<String>,
    status: String,
}

impl Reply {
    fn read(reader: &mut impl BufRead) -> io::Result<Self> {
        let mut data = Vec::new();
        let mut expected = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Speech Dispatcher disconnected",
                ));
            }
            let code = line
                .get(..3)
                .and_then(|s| s.parse::<u16>().ok())
                .ok_or_else(|| io::Error::other("Invalid Speech Dispatcher reply"))?;
            if expected.is_some_and(|expected| expected != code) {
                return Err(io::Error::other("Mismatched Speech Dispatcher reply"));
            }
            expected = Some(code);
            let text = line
                .get(4..)
                .unwrap_or("")
                .trim_end_matches(['\r', '\n'])
                .to_owned();
            match line.as_bytes().get(3) {
                Some(b'-') => data.push(text),
                Some(b' ') => {
                    return Ok(Self {
                        code,
                        data,
                        status: text,
                    })
                }
                _ => return Err(io::Error::other("Invalid Speech Dispatcher reply")),
            }
        }
    }
}

struct Connection {
    stream: UnixStream,
    replies: mpsc::Receiver<Reply>,
    alive: Arc<AtomicBool>,
    prefix: String,
}

impl Connection {
    fn new(stream: UnixStream, emit: Emit) -> io::Result<Self> {
        stream.set_write_timeout(Some(TIMEOUT))?;
        let mut reader = BufReader::new(stream.try_clone()?);
        let (sender, replies) = mpsc::channel();
        let alive = Arc::new(AtomicBool::new(true));
        let reading = alive.clone();
        let prefix = format!("speechd-{}-", CONNECTION_ID.fetch_add(1, Ordering::Relaxed));
        let event_prefix = prefix.clone();
        std::thread::spawn(move || {
            let mut active = HashSet::new();
            while let Ok(reply) = Reply::read(&mut reader) {
                if reply.code / 100 == 7 {
                    if let Some(id) = reply.data.first() {
                        let code = match reply.code {
                            701 => "boundary",
                            702 => "end",
                            703 => "error",
                            _ => continue,
                        };
                        if code != "boundary" {
                            active.remove(id);
                        }
                        emit(Event {
                            utterance_id: format!("{event_prefix}{id}"),
                            code,
                            message: (reply.code == 703).then(|| "Speech interrupted".into()),
                        });
                    }
                } else {
                    if reply.code == 225 {
                        if let Some(id) = reply.data.first() {
                            active.insert(id.clone());
                        }
                    }
                    if sender.send(reply).is_err() {
                        break;
                    }
                }
            }
            reading.store(false, Ordering::Release);
            for id in active {
                emit(Event {
                    utterance_id: format!("{event_prefix}{id}"),
                    code: "error",
                    message: Some("Speech Dispatcher disconnected".into()),
                });
            }
        });
        Ok(Self {
            stream,
            replies,
            alive,
            prefix,
        })
    }

    fn request(&mut self, data: &str, timeout: Duration) -> Result<Reply, String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Speech Dispatcher disconnected".into());
        }
        let reply = self
            .stream
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())
            .and_then(|()| {
                self.replies.recv_timeout(timeout).map_err(|e| match e {
                    mpsc::RecvTimeoutError::Timeout => {
                        "Speech Dispatcher did not answer in time".into()
                    }
                    mpsc::RecvTimeoutError::Disconnected => "Speech Dispatcher disconnected".into(),
                })
            });
        let reply = match reply {
            Ok(reply) => reply,
            Err(error) => {
                let _ = self.stream.shutdown(Shutdown::Both);
                self.alive.store(false, Ordering::Release);
                return Err(error);
            }
        };
        if reply.code / 100 != 2 {
            return Err(format!(
                "Speech Dispatcher: {} {}",
                reply.code, reply.status
            ));
        }
        Ok(reply)
    }

    fn command(&mut self, command: &str) -> Result<Reply, String> {
        if command.contains(['\r', '\n', '\0']) {
            return Err("Invalid speech command".into());
        }
        self.request(&format!("{command}\r\n"), TIMEOUT)
    }

    fn voices(&mut self) -> Result<Vec<Voice>, String> {
        let modules = self.command("LIST OUTPUT_MODULES")?.data;
        let mut voices = Vec::new();
        for module in modules {
            let reply = self
                .command(&format!("SET SELF OUTPUT_MODULE {module}"))
                .and_then(|_| self.request("LIST SYNTHESIS_VOICES\r\n", LIST_TIMEOUT));
            let reply = match reply {
                Ok(reply) => reply,
                // A module without voices is skipped; a lost connection ends the listing.
                Err(error) if !self.alive.load(Ordering::Acquire) => {
                    return Err(format!("{error} while listing {module} voices"));
                }
                Err(_) => continue,
            };
            for row in reply.data {
                let fields: Vec<_> = row.split('\t').collect();
                if fields.len() < 2 || fields[0].is_empty() || fields[1].is_empty() {
                    continue;
                }
                let name = fields[0].to_owned();
                // espeak-ng repeats every voice once per variant
                // ("English (America)+Annie"): 945 English voices instead of 9.
                if fields
                    .get(2)
                    .is_some_and(|variant| name.ends_with(&format!("+{variant}")))
                {
                    continue;
                }
                let lang = fields[1].replace('_', "-");
                // Length-prefixed module + name stays unique even with colons in either.
                voices.push(Voice {
                    id: format!("speechd:{}:{module}{name}", module.len()),
                    name: name.trim().to_owned(),
                    lang,
                    module: module.clone(),
                    synthesis_voice: name,
                });
            }
        }
        if voices.is_empty() {
            return Err("Speech Dispatcher has no installed voices".into());
        }
        // Two engines can share a voice name, so each name carries its module.
        if voices.iter().any(|voice| voice.module != voices[0].module) {
            for voice in &mut voices {
                voice.name = format!("{} ({})", voice.name, voice.module);
            }
        }
        Ok(voices)
    }

    fn set_voice(&mut self, voice: &Voice) -> Result<(), String> {
        self.command(&format!("SET SELF OUTPUT_MODULE {}", voice.module))?;
        self.command(&format!("SET SELF LANGUAGE {}", voice.lang))?;
        self.command(&format!(
            "SET SELF SYNTHESIS_VOICE {}",
            voice.synthesis_voice
        ))?;
        Ok(())
    }

    fn speak(&mut self, text: &str) -> Result<String, String> {
        self.command("SPEAK")?;
        let reply = self.request(&speech_data(text), TIMEOUT)?;
        let id = reply
            .data
            .first()
            .filter(|s| s.parse::<u64>().is_ok())
            .ok_or("Speech Dispatcher did not return an utterance ID")?;
        Ok(format!("{}{id}", self.prefix))
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // speechd finishes a disconnected client's message, so a closed reader
        // window would keep talking to the end of its sentence.
        let _ = self.stream.write_all(b"CANCEL SELF\r\n");
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

// SSIP rates run from -100 to 100 around the module's normal speed; spread the
// reader's 0.5x-1x and 1x-3x over each half so every speed is distinct.
pub(crate) fn ssip_rate(rate: f32) -> i32 {
    let scale = if rate < 1. { 200. } else { 50. };
    ((rate - 1.) * scale).round().clamp(-100., 100.) as i32
}

fn speech_data(text: &str) -> String {
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\0', "");
    let mut data = String::new();
    for line in normalized.split('\n') {
        if line.starts_with('.') {
            data.push('.');
        }
        data.push_str(line);
        data.push_str("\r\n");
    }
    data.push_str(".\r\n");
    data
}

fn socket_path() -> Result<PathBuf, String> {
    if let Ok(address) = std::env::var("SPEECHD_ADDRESS") {
        let path = address
            .strip_prefix("unix_socket:")
            .ok_or("SPEECHD_ADDRESS must use unix_socket: for local speech")?;
        return Ok(PathBuf::from(path));
    }
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .ok_or("No user runtime directory for Speech Dispatcher")?;
    Ok(runtime.join("speech-dispatcher/speechd.sock"))
}

fn connect() -> Result<UnixStream, String> {
    let path = socket_path()?;
    if let Ok(stream) = UnixStream::connect(&path) {
        return Ok(stream);
    }
    // A sandbox must use the host daemon, never try to start one inside it.
    if std::path::Path::new("/.flatpak-info").exists() {
        return Err("Speech Dispatcher socket is unavailable in the Flatpak sandbox".into());
    }
    let mut child =
        Command::new(std::env::var_os("SPEECHD_CMD").unwrap_or_else(|| "speech-dispatcher".into()))
            .args([
                "--spawn",
                "--communication-method",
                "unix_socket",
                "--socket-path",
            ])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Cannot start Speech Dispatcher: {e}"))?;
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Speech Dispatcher startup timed out".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    UnixStream::connect(&path).map_err(|e| format!("Cannot connect to Speech Dispatcher: {e}"))
}

struct Session {
    connection: Connection,
    voices: Vec<Voice>,
    utterance: Option<String>,
}

#[derive(Default)]
pub(crate) struct SpeechDispatcher(Mutex<Option<Session>>);

#[derive(Default)]
pub(crate) struct SpeechSessions(Mutex<std::collections::HashMap<String, Arc<SpeechDispatcher>>>);

impl SpeechSessions {
    pub(crate) fn get(&self, window: &str) -> Arc<SpeechDispatcher> {
        self.0
            .lock()
            .unwrap()
            .entry(window.to_owned())
            .or_default()
            .clone()
    }

    pub(crate) fn remove(&self, window: &str) {
        self.0.lock().unwrap().remove(window);
    }
}

impl SpeechDispatcher {
    pub(crate) fn init(&self, emit: Emit) -> Result<(), String> {
        let mut session = self.0.lock().unwrap();
        if session
            .as_ref()
            .is_some_and(|s| s.connection.alive.load(Ordering::Acquire))
        {
            return Ok(());
        }
        *session = None;
        let mut connection = Connection::new(connect()?, emit).map_err(|e| e.to_string())?;
        connection.command("SET SELF CLIENT_NAME readest:readest:main")?;
        connection.command("SET SELF PRIORITY TEXT")?;
        connection.command("SET SELF SSML_MODE off")?;
        for event in ["BEGIN", "END", "CANCEL"] {
            connection.command(&format!("SET SELF NOTIFICATION {event} on"))?;
        }
        let voices = connection.voices()?;
        connection.set_voice(&voices[0])?;
        *session = Some(Session {
            connection,
            voices,
            utterance: None,
        });
        Ok(())
    }

    fn with_session<T>(
        &self,
        f: impl FnOnce(&mut Session) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut session = self.0.lock().unwrap();
        f(session
            .as_mut()
            .ok_or("Speech Dispatcher is not initialized")?)
    }

    pub(crate) fn voices(&self) -> Result<Vec<(String, String, String)>, String> {
        self.with_session(|s| {
            Ok(s.voices
                .iter()
                .map(|v| (v.id.clone(), v.name.clone(), v.lang.clone()))
                .collect())
        })
    }

    pub(crate) fn set_voice(&self, id: &str) -> Result<(), String> {
        self.with_session(|s| {
            let voice = s
                .voices
                .iter()
                .find(|v| v.id == id)
                .ok_or("Unknown Speech Dispatcher voice")?;
            s.connection.set_voice(voice)
        })
    }

    pub(crate) fn speak(&self, text: &str) -> Result<String, String> {
        self.with_session(|s| {
            let id = s.connection.speak(text)?;
            s.utterance = Some(id.clone());
            Ok(id)
        })
    }

    pub(crate) fn stop(&self, utterance: Option<&str>) -> Result<(), String> {
        self.with_session(|s| {
            if utterance.is_some_and(|id| s.utterance.as_deref() != Some(id)) {
                return Ok(());
            }
            s.connection.command("CANCEL SELF")?;
            s.utterance = None;
            Ok(())
        })
    }

    // Like Android's TextToSpeech.stop(): the reader restarts the sentence on
    // play. A speechd PAUSE would hold that SPEAK back, then cancel it on RESUME.
    pub(crate) fn pause(&self) -> Result<(), String> {
        self.stop(None)
    }

    pub(crate) fn command(&self, command: &str) -> Result<(), String> {
        self.with_session(|s| s.connection.command(command).map(|_| ()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connects_to_speech_dispatcher() {
        let (client, _server) = UnixStream::pair().unwrap();
        assert!(
            Connection::new(client, Arc::new(|_| {})).is_ok(),
            "Linux system TTS must connect to Speech Dispatcher"
        );
    }

    #[test]
    fn readers_have_independent_connections_and_close_releases_them() {
        let sessions = SpeechSessions::default();
        let first = sessions.get("reader-one");
        let second = sessions.get("reader-two");
        assert!(!Arc::ptr_eq(&first, &second));
        assert!(Arc::ptr_eq(&first, &sessions.get("reader-one")));
        sessions.remove("reader-one");
        assert!(!Arc::ptr_eq(&first, &sessions.get("reader-one")));
        assert!(Arc::ptr_eq(&second, &sessions.get("reader-two")));
    }

    #[test]
    fn stale_cancellation_does_not_cancel_replacement_speech() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let speech = SpeechDispatcher(Mutex::new(Some(Session {
            connection: Connection::new(client, Arc::new(|_| {})).unwrap(),
            voices: Vec::new(),
            utterance: Some("new-speech".into()),
        })));
        speech.stop(Some("old-speech")).unwrap();
        server.set_nonblocking(true).unwrap();
        let mut line = String::new();
        assert_eq!(
            BufReader::new(server.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap_err()
                .kind(),
            io::ErrorKind::WouldBlock
        );
        server.set_nonblocking(false).unwrap();
        let worker = std::thread::spawn(move || {
            BufReader::new(server.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            assert_eq!(line, "CANCEL SELF\r\n");
            server.write_all(b"208 OK\r\n").unwrap();
        });
        speech.stop(Some("new-speech")).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn enumerates_modules_and_selects_the_exact_voice_after_language() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let mut connection = Connection::new(client, Arc::new(|_| {})).unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            let cases = [
                (
                    "LIST OUTPUT_MODULES",
                    "250-broken\r\n250-espeak-ng\r\n250-piper\r\n250 OK\r\n",
                ),
                ("SET SELF OUTPUT_MODULE broken", "200 OK\r\n"),
                ("LIST SYNTHESIS_VOICES", "500 No voices\r\n"),
                ("SET SELF OUTPUT_MODULE espeak-ng", "200 OK\r\n"),
                (
                    "LIST SYNTHESIS_VOICES",
                    "249-English (America)\ten_US\tnone\r\n249 OK\r\n",
                ),
                ("SET SELF OUTPUT_MODULE piper", "200 OK\r\n"),
                (
                    "LIST SYNTHESIS_VOICES",
                    "249-English (America)\ten_US\tnone\r\n249 OK\r\n",
                ),
                ("SET SELF OUTPUT_MODULE piper", "200 OK\r\n"),
                ("SET SELF LANGUAGE en-US", "200 OK\r\n"),
                ("SET SELF SYNTHESIS_VOICE English (America)", "200 OK\r\n"),
            ];
            for (command, reply) in cases {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert_eq!(line, format!("{command}\r\n"));
                server.write_all(reply.as_bytes()).unwrap();
            }
        });
        let voices = connection.voices().unwrap();
        assert_eq!(voices.len(), 2);
        assert_ne!(voices[0].id, voices[1].id);
        assert_eq!(voices[1].lang, "en-US");
        // Two engines can share a voice name, so each name carries its module.
        assert_eq!(voices[0].name, "English (America) (espeak-ng)");
        assert_eq!(voices[1].name, "English (America) (piper)");
        connection.set_voice(&voices[1]).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn lists_each_espeak_voice_once_rather_than_once_per_variant() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let mut connection = Connection::new(client, Arc::new(|_| {})).unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            for reply in [
                "250-espeak-ng\r\n250 OK\r\n",
                "200 OK\r\n",
                "249-English (America)\ten-US\tnone\r\n\
                 249-English (America)+Annie\ten-US\tAnnie\r\n\
                 249-English (America)+croak\ten-US\tcroak\r\n\
                 249-English (Great Britain)\ten-GB\tnone\r\n249 OK\r\n",
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                server.write_all(reply.as_bytes()).unwrap();
            }
        });
        let voices: Vec<_> = connection
            .voices()
            .unwrap()
            .into_iter()
            .map(|voice| voice.synthesis_voice)
            .collect();
        assert_eq!(voices, ["English (America)", "English (Great Britain)"]);
        worker.join().unwrap();
    }

    #[test]
    fn waits_for_a_slow_voice_list() {
        // espeak-ng sends ~15k voice rows; that takes 0.4 s on a fast desktop.
        let (client, mut server) = UnixStream::pair().unwrap();
        let mut connection = Connection::new(client, Arc::new(|_| {})).unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            for (delay, reply) in [
                (Duration::ZERO, "250-espeak-ng\r\n250 OK\r\n"),
                (Duration::ZERO, "200 OK\r\n"),
                (
                    TIMEOUT + Duration::from_millis(500),
                    "249-English (America)\ten-US\tnone\r\n249 OK\r\n",
                ),
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                std::thread::sleep(delay);
                server.write_all(reply.as_bytes()).unwrap();
            }
        });
        let voices = connection
            .voices()
            .expect("a voice list slower than one command must still arrive");
        assert_eq!(voices.len(), 1);
        worker.join().unwrap();
    }

    #[test]
    fn a_lost_connection_while_listing_voices_reports_the_cause() {
        let (client, server) = UnixStream::pair().unwrap();
        let mut connection = Connection::new(client, Arc::new(|_| {})).unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            for reply in ["250-espeak-ng\r\n250-piper\r\n250 OK\r\n", "200 OK\r\n"] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                (&server).write_all(reply.as_bytes()).unwrap();
            }
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            server.shutdown(Shutdown::Both).unwrap();
        });
        assert_eq!(
            connection.voices().err().as_deref(),
            Some("Speech Dispatcher disconnected while listing espeak-ng voices")
        );
        worker.join().unwrap();
    }

    #[test]
    fn shows_speechd_voice_names_without_a_lone_module() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let mut connection = Connection::new(client, Arc::new(|_| {})).unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            for reply in [
                "250-espeak-ng\r\n250 OK\r\n",
                "200 OK\r\n",
                "249-English (America)\ten-US\tnone\r\n\
                 249-English (America, New York City)\ten-US-NYC\tnone\r\n\
                 249-German\tde\tnone\r\n249-Cherokee \tchr\tnone\r\n249 OK\r\n",
            ] {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                server.write_all(reply.as_bytes()).unwrap();
            }
        });
        let names: Vec<_> = connection
            .voices()
            .unwrap()
            .into_iter()
            .map(|voice| voice.name)
            .collect();
        assert_eq!(
            names,
            [
                "English (America)",
                "English (America, New York City)",
                "German",
                "Cherokee"
            ]
        );
        worker.join().unwrap();
    }

    #[test]
    fn pause_cancels_so_the_restarted_sentence_is_not_held_back() {
        let (client, server) = UnixStream::pair().unwrap();
        let speech = SpeechDispatcher(Mutex::new(Some(Session {
            connection: Connection::new(client, Arc::new(|_| {})).unwrap(),
            voices: Vec::new(),
            utterance: None,
        })));
        let worker = std::thread::spawn(move || {
            let mut line = String::new();
            BufReader::new(server.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            (&server).write_all(b"213 OK CANCELED\r\n").unwrap();
            line
        });
        speech.pause().unwrap();
        assert_eq!(worker.join().unwrap(), "CANCEL SELF\r\n");
    }

    #[test]
    fn closing_a_reader_window_silences_its_speech() {
        // speechd keeps speaking a disconnected client's message to its end.
        let (client, server) = UnixStream::pair().unwrap();
        let sessions = SpeechSessions::default();
        *sessions.get("reader").0.lock().unwrap() = Some(Session {
            connection: Connection::new(client, Arc::new(|_| {})).unwrap(),
            voices: Vec::new(),
            utterance: None,
        });
        sessions.remove("reader");
        let mut sent = String::new();
        io::Read::read_to_string(&mut &server, &mut sent).unwrap();
        assert_eq!(sent, "CANCEL SELF\r\n");
    }

    #[test]
    fn every_reader_speed_has_its_own_ssip_rate() {
        // The speed ruler and RSVP offer 0.5x to 3x.
        let rates: Vec<_> = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0]
            .into_iter()
            .map(ssip_rate)
            .collect();
        assert_eq!(rates, [-100, -50, 0, 25, 50, 75, 100]);
    }

    #[test]
    fn text_cannot_terminate_speech_or_inject_commands() {
        assert_eq!(
            speech_data(".\r\nCANCEL ALL\r..hello\n世界"),
            "..\r\nCANCEL ALL\r\n...hello\r\n世界\r\n.\r\n"
        );
    }

    #[test]
    fn parses_multiline_voices_with_spaces_and_variants() {
        let reply = Reply::read(&mut io::Cursor::new(
            "249-English (America)\ten_US\tnone\r\n249-English+Annie\ten_US\tAnnie\r\n249 OK\r\n",
        ))
        .unwrap();
        assert_eq!(reply.code, 249);
        assert_eq!(
            reply.data,
            [
                "English (America)\ten_US\tnone",
                "English+Annie\ten_US\tAnnie"
            ]
        );
    }

    #[test]
    fn routes_early_events_and_disconnect_to_the_utterance() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let (sender, events) = mpsc::channel();
        let mut connection = Connection::new(
            client,
            Arc::new(move |event| {
                sender.send(event).unwrap();
            }),
        )
        .unwrap();
        let worker = std::thread::spawn(move || {
            let mut reader = BufReader::new(server.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line, "SPEAK\r\n");
            server.write_all(b"230 OK\r\n").unwrap();
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == ".\r\n" {
                    break;
                }
            }
            server
                .write_all(b"225-42\r\n225 OK\r\n701-42\r\n701-5\r\n701 BEGIN\r\n")
                .unwrap();
        });
        let id = connection.speak("Hello").unwrap();
        let begin = events.recv_timeout(TIMEOUT).unwrap();
        assert_eq!(begin.utterance_id, id);
        assert_eq!(begin.code, "boundary");
        let error = events.recv_timeout(TIMEOUT).unwrap();
        assert_eq!(error.utterance_id, id);
        assert_eq!(error.code, "error");
        assert_eq!(
            error.message.as_deref(),
            Some("Speech Dispatcher disconnected")
        );
        worker.join().unwrap();
    }

    #[test]
    fn cancellation_is_terminal_but_does_not_advance_reading() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let (sender, events) = mpsc::channel();
        let _connection = Connection::new(
            client,
            Arc::new(move |event| {
                sender.send(event).unwrap();
            }),
        )
        .unwrap();
        server
            .write_all(b"703-42\r\n703-5\r\n703 CANCELED\r\n")
            .unwrap();
        let event = events.recv_timeout(TIMEOUT).unwrap();
        assert_eq!(event.code, "error");
        assert_eq!(event.message.as_deref(), Some("Speech interrupted"));
    }
}
