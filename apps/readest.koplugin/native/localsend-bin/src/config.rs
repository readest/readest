//! ls_start configuration passed from Lua as one JSON string.

use localsend::model::discovery::DeviceType;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    pub alias: String,
    pub device_model: String,
    /// "mobile" or "desktop"; anything else falls back to mobile.
    pub device_type: String,
    /// Where identity.pem lives. Outside the plugin dir so self-update
    /// keeps the fingerprint peers have pinned.
    pub data_dir: String,
    /// Where accepted files land; staging lives in .localsend-inbox below it.
    pub download_dir: String,
}

impl StartConfig {
    pub fn parse(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }

    pub fn device_type(&self) -> DeviceType {
        match self.device_type.as_str() {
            "desktop" => DeviceType::Desktop,
            _ => DeviceType::Mobile,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_camel_case_config() {
        let cfg = StartConfig::parse(
            r#"{"alias":"Kindle Oasis","deviceModel":"KOReader","deviceType":"mobile","dataDir":"/tmp/d","downloadDir":"/tmp/dl"}"#,
        )
        .unwrap();
        assert_eq!(cfg.alias, "Kindle Oasis");
        assert_eq!(cfg.device_model, "KOReader");
        assert_eq!(cfg.download_dir, "/tmp/dl");
        assert!(matches!(cfg.device_type(), DeviceType::Mobile));
    }

    #[test]
    fn desktop_maps_unknown_falls_back_to_mobile() {
        let mk = |t: &str| {
            StartConfig::parse(&format!(
                r#"{{"alias":"a","deviceModel":"m","deviceType":"{t}","dataDir":"/d","downloadDir":"/l"}}"#
            ))
            .unwrap()
        };
        assert!(matches!(mk("desktop").device_type(), DeviceType::Desktop));
        assert!(matches!(mk("toaster").device_type(), DeviceType::Mobile));
    }

    #[test]
    fn missing_field_is_an_error() {
        assert!(StartConfig::parse(r#"{"alias":"x"}"#).is_err());
    }
}
