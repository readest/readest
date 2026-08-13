//! Ported from apps/readest-app/src-tauri/src/localsend/identity.rs; the device type comes from the caller (KOReader passes "mobile") instead of a compile-time cfg.

use anyhow::Context;
use localsend::crypto::cert::fingerprint_from_cert_der;
use localsend::discovery::DeviceIdentity;
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
                    alias,
                    device_model,
                    device_type,
                    fingerprint: cert.fingerprint,
                    cert_pem: cert.certificate_pem,
                    key_pem: cert.private_key_pem,
                };
                identity
                    .save(&path)
                    .with_context(|| format!("could not save {}", path.display()))?;
                Ok(identity)
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
        let _ = std::fs::remove_dir_all(&dir);
    }
}
