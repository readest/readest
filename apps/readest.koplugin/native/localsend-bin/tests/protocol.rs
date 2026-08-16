//! Spawns the built localsend-helper binary and drives it over its control
//! socket. `service::start` inside the helper binds real ports and the
//! LocalSend multicast group, so this is ignored by default. Run manually:
//!   cargo test --test protocol -- --ignored --nocapture

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
#[ignore = "spawns a real process and binds real ports/multicast; run manually"]
fn start_command_yields_started_event_then_stops_cleanly() {
    // Grab a free port by binding to :0 and dropping the listener before the
    // helper binds it itself. A small window exists where another process
    // could steal the port first; acceptable for a manually-run test.
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        listener.local_addr().unwrap().port()
    };

    let mut child = Command::new(env!("CARGO_BIN_EXE_localsend-helper"))
        .arg("--control-port")
        .arg(port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn localsend-helper");

    // Wait for the "ready" line on stdout before connecting.
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ready_line = String::new();
    stdout.read_line(&mut ready_line).expect("read ready line");
    assert!(
        ready_line.contains("localsend-helper ready"),
        "unexpected first stdout line: {ready_line}"
    );

    let stream = connect_with_retries(port);

    let base = std::env::temp_dir().join(format!("lsh-protocol-{}", std::process::id()));
    let start_cmd = serde_json::json!({
        "cmd": "start",
        "alias": "protocol-test",
        "deviceModel": "KOReader",
        "deviceType": "mobile",
        "dataDir": base.join("data").to_string_lossy(),
        "downloadDir": base.join("dl").to_string_lossy(),
    })
    .to_string();
    let mut writer = stream.try_clone().expect("clone stream for writing");
    writeln!(writer, "{start_cmd}").expect("send start command");

    let mut reader = BufReader::new(stream);
    let mut started = false;
    for _ in 0..50 {
        let mut line = String::new();
        let n = reader.read_line(&mut line).expect("read event line");
        if n == 0 {
            break; // EOF
        }
        if line.contains(r#""type":"started""#) {
            started = true;
            break;
        }
    }
    assert!(started, "no started event observed on the control socket");

    writeln!(writer, r#"{{"cmd":"stop"}}"#).expect("send stop command");

    let status = child.wait().expect("wait on localsend-helper");
    assert!(status.success(), "helper did not exit cleanly: {status:?}");

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
#[ignore = "spawns a real process and binds real ports/multicast; run manually"]
fn list_devices_command_yields_devices_event() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        listener.local_addr().unwrap().port()
    };

    let mut child = Command::new(env!("CARGO_BIN_EXE_localsend-helper"))
        .arg("--control-port")
        .arg(port.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn localsend-helper");

    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ready_line = String::new();
    stdout.read_line(&mut ready_line).expect("read ready line");

    let stream = connect_with_retries(port);
    let base = std::env::temp_dir().join(format!("lsh-devices-{}", std::process::id()));
    let start_cmd = serde_json::json!({
        "cmd": "start",
        "alias": "protocol-test",
        "deviceModel": "KOReader",
        "deviceType": "mobile",
        "dataDir": base.join("data").to_string_lossy(),
        "downloadDir": base.join("dl").to_string_lossy(),
    })
    .to_string();
    let mut writer = stream.try_clone().expect("clone stream for writing");
    writeln!(writer, "{start_cmd}").expect("send start command");

    let mut reader = BufReader::new(stream);
    let mut started = false;
    for _ in 0..50 {
        let mut line = String::new();
        let n = reader.read_line(&mut line).expect("read event line");
        if n == 0 {
            break;
        }
        if line.contains(r#""type":"started""#) {
            started = true;
            break;
        }
    }
    assert!(started, "no started event observed on the control socket");

    writeln!(writer, r#"{{"cmd":"list_devices"}}"#).expect("send list_devices command");
    let mut devices_seen = false;
    for _ in 0..50 {
        let mut line = String::new();
        let n = reader.read_line(&mut line).expect("read event line");
        if n == 0 {
            break;
        }
        if line.contains(r#""type":"devices""#) {
            devices_seen = true;
            assert!(line.contains(r#""devices":["#), "{line}");
            break;
        }
    }
    assert!(
        devices_seen,
        "no devices event observed on the control socket"
    );

    writeln!(writer, r#"{{"cmd":"stop"}}"#).expect("send stop command");
    let status = child.wait().expect("wait on localsend-helper");
    assert!(status.success(), "helper did not exit cleanly: {status:?}");

    let _ = std::fs::remove_dir_all(&base);
}

fn connect_with_retries(port: u16) -> TcpStream {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(stream) => return stream,
            Err(err) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
                let _ = err;
            }
            Err(err) => panic!("could not connect to helper control port {port}: {err}"),
        }
    }
}
