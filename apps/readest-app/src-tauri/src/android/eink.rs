use std::process::Command;

/// Known e-ink device manufacturers and brands (case-insensitive matching)
const EINK_MANUFACTURERS: &[&str] = &[
    "onyx",       // BOOX devices
    "boox",       // BOOX devices (alternate)
    "amazon",     // Kindle devices
    "kobo",       // Kobo e-readers
    "remarkable", // reMarkable tablets
    "pocketbook", // PocketBook e-readers
    "boyue",      // Boyue/Likebook devices
    "likebook",   // Likebook devices
    "dasung",     // Dasung e-ink monitors
    "bigme",      // Bigme e-readers
    "hisense",    // Hisense e-ink phones (A5, A7, etc.)
    "hanvon",     // Hanvon e-readers
    "tolino",     // Tolino e-readers
    "bookeen",    // Bookeen e-readers
    "supernote",  // Supernote devices
    "mobiscribe", // Mobiscribe e-readers
    "xiaomi",     // Xiaomi InkPalm (needs model check)
    "meebook",    // Meebook e-readers
];

/// Known e-ink device models (for manufacturers that also make non-e-ink devices)
const EINK_MODELS: &[&str] = &[
    "kindle",
    "a5pro",
    "a7cc", // Hisense e-ink models
    "a7e",
    "a9",
    "inkpalm", // Xiaomi InkPalm
    "eink",
    "e-ink",
    "paper",
    "note air",
    "note2",
    "note3",
    "note5",
    "nova",
    "poke",
    "leaf",
    "page",
    "tab ultra",
    "max lumi",
];

/// Get Android system property using getprop command
fn get_system_property(prop: &str) -> Option<String> {
    Command::new("getprop")
        .arg(prop)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            } else {
                None
            }
        })
}

/// Check if the current Android device is an e-ink device
pub fn is_eink_device() -> bool {
    // Get device manufacturer and model
    let manufacturer = get_system_property("ro.product.manufacturer")
        .or_else(|| get_system_property("ro.product.brand"))
        .unwrap_or_default()
        .to_lowercase();

    let model = get_system_property("ro.product.model")
        .or_else(|| get_system_property("ro.product.device"))
        .unwrap_or_default()
        .to_lowercase();

    let device = get_system_property("ro.product.device")
        .unwrap_or_default()
        .to_lowercase();

    // Check if manufacturer matches known e-ink manufacturers
    for eink_manufacturer in EINK_MANUFACTURERS {
        if manufacturer.contains(eink_manufacturer) {
            // Special case for manufacturers that make both e-ink and non-e-ink devices
            if *eink_manufacturer == "hisense" || *eink_manufacturer == "xiaomi" {
                // Need to also check the model for these manufacturers
                for eink_model in EINK_MODELS {
                    if model.contains(eink_model) || device.contains(eink_model) {
                        return true;
                    }
                }
            } else {
                return true;
            }
        }
    }

    // Check if model matches known e-ink models
    for eink_model in EINK_MODELS {
        if model.contains(eink_model) || device.contains(eink_model) {
            return true;
        }
    }

    // Check for e-ink specific system properties
    if let Some(eink_support) = get_system_property("ro.eink.support") {
        if eink_support == "1" || eink_support.to_lowercase() == "true" {
            return true;
        }
    }

    // Check for BOOX specific property
    if get_system_property("ro.onyx.devicename").is_some() {
        return true;
    }

    false
}
