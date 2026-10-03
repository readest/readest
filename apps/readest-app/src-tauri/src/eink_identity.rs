//! Pure e-ink device identity matching.
//!
//! Kept outside the Android-only module so its unit tests compile and run on
//! the host in CI (`cargo test --lib`).

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
    "ireader",    // iReader e-readers
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

/// Match the device identity fields against the known e-ink whitelists.
///
/// Some readers report the SoC vendor (e.g. `QUALCOMM`) as the manufacturer and
/// carry the reader brand only in `ro.product.brand`, so the manufacturer/brand
/// whitelist is matched against both fields joined as one string.
///
/// All four inputs are expected to be already lowercased by the caller.
pub fn is_eink_identity(manufacturer: &str, brand: &str, model: &str, device: &str) -> bool {
    let brands = format!("{manufacturer} {brand}");

    // Check if manufacturer or brand matches a known e-ink manufacturer
    for eink_manufacturer in EINK_MANUFACTURERS {
        if brands.contains(eink_manufacturer) {
            // Special case for manufacturers that make both e-ink and non-e-ink devices
            if *eink_manufacturer == "hisense" || *eink_manufacturer == "xiaomi" {
                // Need to also check the model for these manufacturers
                if EINK_MODELS
                    .iter()
                    .any(|eink_model| model.contains(eink_model) || device.contains(eink_model))
                {
                    return true;
                }
            } else {
                return true;
            }
        }
    }

    // Check if model matches known e-ink models
    EINK_MODELS
        .iter()
        .any(|eink_model| model.contains(eink_model) || device.contains(eink_model))
}

#[cfg(test)]
mod tests {
    use super::is_eink_identity;

    /// HANVON Clear7 reports the SoC vendor as manufacturer; brand must still match.
    #[test]
    fn detects_hanvon_when_manufacturer_is_soc_vendor() {
        // HANVON Clear7 (Jinli): ro.product.manufacturer reports QUALCOMM,
        // the reader brand only lives in ro.product.brand.
        assert!(is_eink_identity(
            "qualcomm",
            "hanvon",
            "clear7",
            "bengal_515"
        ));
    }

    /// Plain e-ink-only brands match on manufacturer or brand alone.
    #[test]
    fn detects_regular_eink_brands() {
        assert!(is_eink_identity("onyx", "boox", "palma", "musu"));
        assert!(is_eink_identity("", "tolino", "tab7", "ntx_6"));
        assert!(is_eink_identity("amazon", "amazon", "kinds3", "walleye"));
    }

    /// An unknown OEM still matches when the model carries a known e-ink name.
    #[test]
    fn detects_by_model_when_no_brand_matches() {
        assert!(is_eink_identity(
            "someoem",
            "somebrand",
            "inknote_a5pro",
            "xxx"
        ));
    }

    /// Mixed-lineup brands (Xiaomi, Hisense) only match with an e-ink model.
    #[test]
    fn phone_brands_need_an_eink_model() {
        assert!(!is_eink_identity("xiaomi", "redmi", "m2012k11c", "venus"));
        assert!(is_eink_identity("xiaomi", "xiaomi", "inkpalm", "lapis"));
        assert!(!is_eink_identity(
            "hisense",
            "hisense",
            "dub-al00a",
            "wayne"
        ));
        assert!(is_eink_identity("hisense", "hisense", "hlj-bd60", "a5pro"));
    }

    /// Ordinary phones must not match, even with e-ink-ish substrings elsewhere.
    #[test]
    fn rejects_plain_phone() {
        assert!(!is_eink_identity("google", "google", "pixel 9", "tegu"));
        assert!(!is_eink_identity("samsung", "samsung", "sm-g9910", "r8q"));
        // Manufacturer tokens must not match against model/device strings
        assert!(!is_eink_identity("qualcomm", "samsung", "sm-boox99", "r8q"));
    }
}
