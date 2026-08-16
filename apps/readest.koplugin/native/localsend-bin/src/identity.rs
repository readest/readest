//! Ported from apps/readest-app/src-tauri/src/localsend/identity.rs; the device type comes from the caller (KOReader passes "mobile") instead of a compile-time cfg.

use anyhow::Context;
use localsend::crypto::cert::fingerprint_from_cert_der;
use localsend::discovery::DeviceIdentity;
use localsend::http::dto_v2::RegisterDtoV2;
use localsend::http::server::TlsConfig;
use localsend::http::state::ClientInfo;
use localsend::model::discovery::{DeviceType, ProtocolType, PROTOCOL_VERSION_V2};
use localsend::multicast::MulticastDevice;
use std::path::Path;

pub struct Identity {
    pub alias: String,
    /// Shown as the device tag by other LocalSend clients — the OS name
    /// ("macOS", "iOS", "Android", ...) resolved by the frontend. Not
    /// persisted; supplied on every start.
    pub device_model: String,
    pub device_type: DeviceType,
    pub cert_pem: String,
    pub key_pem: String,
    pub fingerprint: String,
}

impl Identity {
    /// Loads the identity from `identity.pem` in `dir`, generating and saving
    /// a fresh one when the file does not exist yet. The certificate is what
    /// peers pin, so it must survive restarts.
    pub fn load_or_generate(
        dir: &Path,
        alias: String,
        device_model: String,
        device_type: DeviceType,
    ) -> anyhow::Result<Self> {
        let path = dir.join("identity.pem");
        match std::fs::read_to_string(&path) {
            Ok(text) => Self::from_pem(&text, alias, device_model, device_type)
                .with_context(|| format!("invalid identity file: {}", path.display())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let cert = localsend::crypto::cert::generate_self_signed()?;
                let identity = Self {
                    alias: alias.clone(),
                    device_model: device_model.clone(),
                    device_type: device_type.clone(),
                    fingerprint: cert.fingerprint,
                    cert_pem: cert.certificate_pem,
                    key_pem: cert.private_key_pem,
                };
                match identity.save(&path) {
                    Ok(()) => Ok(identity),
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        // Lost a create-new race to a concurrent keygen: two
                        // ls_start workers can overlap (e.g. a screen sleep
                        // mid-keygen followed by a quick stop/start), both
                        // see no identity.pem and both generate a cert, but
                        // only the first save() wins. Adopt the winner's
                        // identity instead of failing, so both callers agree
                        // on the fingerprint peers end up pinning.
                        //
                        // The winner's create_new() claims the file before
                        // its write_all() finishes, so a read right here can
                        // land inside that window and see a partial (or
                        // empty) file. Retry a handful of times with a short
                        // sleep to ride it out; this runs on the ls_start
                        // worker thread (off the UI thread), so blocking
                        // briefly here is fine. Only a truly corrupt file
                        // exhausts every attempt.
                        const MAX_ATTEMPTS: u32 = 10;
                        let mut last_err = anyhow::anyhow!(
                            "could not read {} after {MAX_ATTEMPTS} attempts",
                            path.display()
                        );
                        for attempt in 0..MAX_ATTEMPTS {
                            if attempt > 0 {
                                std::thread::sleep(std::time::Duration::from_millis(5));
                            }
                            let text = match std::fs::read_to_string(&path) {
                                Ok(text) => text,
                                Err(err) => {
                                    last_err = anyhow::Error::new(err)
                                        .context(format!("could not read {}", path.display()));
                                    continue;
                                }
                            };
                            match Self::from_pem(
                                &text,
                                alias.clone(),
                                device_model.clone(),
                                device_type.clone(),
                            ) {
                                Ok(identity) => return Ok(identity),
                                Err(err) => {
                                    last_err = err.context(format!(
                                        "invalid identity file: {}",
                                        path.display()
                                    ));
                                }
                            }
                        }
                        Err(last_err)
                    }
                    Err(err) => {
                        Err(err).with_context(|| format!("could not save {}", path.display()))
                    }
                }
            }
            Err(err) => Err(err).context(format!("could not read {}", path.display())),
        }
    }

    fn from_pem(
        text: &str,
        alias: String,
        device_model: String,
        device_type: DeviceType,
    ) -> anyhow::Result<Self> {
        let blocks = pem::parse_many(text)?;
        let cert = blocks
            .iter()
            .find(|block| block.tag() == "CERTIFICATE")
            .context("missing CERTIFICATE block")?;
        let key = blocks
            .iter()
            .find(|block| block.tag().ends_with("PRIVATE KEY"))
            .context("missing PRIVATE KEY block")?;
        Ok(Self {
            alias,
            device_model,
            device_type,
            fingerprint: fingerprint_from_cert_der(cert.contents()),
            cert_pem: pem::encode(cert),
            key_pem: pem::encode(key),
        })
    }

    fn save(&self, path: &Path) -> std::io::Result<()> {
        let contents = format!("{}{}", self.cert_pem, self.key_pem);
        // The file contains the private key; keep it owner-readable only.
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)?;
            file.write_all(contents.as_bytes())
        }
        #[cfg(not(unix))]
        std::fs::write(path, contents)
    }

    pub fn tls_config(&self) -> TlsConfig {
        TlsConfig {
            cert: self.cert_pem.clone(),
            private_key: self.key_pem.clone(),
        }
    }

    pub fn device_identity(&self) -> DeviceIdentity {
        DeviceIdentity {
            cert_pem: self.cert_pem.clone(),
            private_key_pem: self.key_pem.clone(),
        }
    }

    pub fn client_info(&self) -> ClientInfo {
        ClientInfo {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some(self.device_model.clone()),
            device_type: Some(self.device_type.clone()),
            token: self.fingerprint.clone(),
        }
    }

    /// The registration announced when this device sends a `prepare-upload`
    /// request, i.e. what `run_send` puts on the wire as `info`. Ported from
    /// `Identity::register_dto` in
    /// apps/readest-app/src-tauri/src/localsend/identity.rs.
    pub fn register_dto(&self, port: u16) -> RegisterDtoV2 {
        RegisterDtoV2 {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some(self.device_model.clone()),
            device_type: Some(self.device_type.clone()),
            fingerprint: self.fingerprint.clone(),
            port,
            protocol: ProtocolType::Https,
            download: false,
        }
    }

    pub fn multicast_device(&self, port: u16) -> MulticastDevice {
        MulticastDevice {
            alias: self.alias.clone(),
            version: PROTOCOL_VERSION_V2.to_string(),
            device_model: Some(self.device_model.clone()),
            device_type: Some(self.device_type.clone()),
            fingerprint: self.fingerprint.clone(),
            port,
            protocol: ProtocolType::Https,
            download: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use localsend::model::discovery::DeviceType;

    #[test]
    fn identity_roundtrip_keeps_fingerprint() {
        let dir = std::env::temp_dir().join(format!("lsffi-id-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join("identity.pem"));
        let a =
            Identity::load_or_generate(&dir, "KO".into(), "KOReader".into(), DeviceType::Mobile)
                .unwrap();
        let b =
            Identity::load_or_generate(&dir, "KO".into(), "KOReader".into(), DeviceType::Mobile)
                .unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
        assert!(a.cert_pem.contains("BEGIN CERTIFICATE"));
        assert_eq!(
            a.multicast_device(53318).device_model.as_deref(),
            Some("KOReader")
        );
        let dto = a.register_dto(53318);
        assert_eq!(dto.alias, "KO");
        assert_eq!(dto.device_model.as_deref(), Some("KOReader"));
        assert_eq!(dto.fingerprint, a.fingerprint);
        assert_eq!(dto.port, 53318);
        assert!(matches!(dto.protocol, ProtocolType::Https));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_or_generate_racing_writers_converge_on_one_fingerprint() {
        // Simulates two ls_start workers overlapping on a fresh data dir
        // (e.g. a screen sleep mid-keygen followed by a quick ls_stop then
        // ls_start): both threads see no identity.pem and both generate a
        // cert, but only one create_new() save() can win. The loser must
        // adopt the winner's identity instead of returning an error.
        let dir = std::env::temp_dir().join(format!("lsffi-id-race-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let spawn = |dir: std::path::PathBuf, barrier: std::sync::Arc<std::sync::Barrier>| {
            std::thread::spawn(move || {
                barrier.wait();
                Identity::load_or_generate(&dir, "KO".into(), "KOReader".into(), DeviceType::Mobile)
            })
        };
        let t1 = spawn(dir.clone(), barrier.clone());
        let t2 = spawn(dir.clone(), barrier);

        let a = t1.join().unwrap().expect("winner should succeed");
        let b = t2
            .join()
            .unwrap()
            .expect("loser should adopt the winner's identity instead of erroring");
        assert_eq!(a.fingerprint, b.fingerprint);

        let _ = std::fs::remove_dir_all(&dir);
    }

    // A dedicated test that forces the AlreadyExists retry loop to actually
    // observe a partial read, as opposed to
    // load_or_generate_racing_writers_converge_on_one_fingerprint above
    // (which exercises the same arm but with real thread-scheduling timing,
    // where the winner's write_all of a few KB typically completes before
    // the loser's read lands), would need to pause save()'s own write_all
    // mid-flight, i.e. a test seam in production code. That's out of scope
    // here and would be its own source of flakiness, so the race test above
    // (real concurrent load_or_generate callers converging on one
    // fingerprint) is left as the coverage for this path.
}
