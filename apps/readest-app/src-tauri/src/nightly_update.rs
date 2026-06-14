//! Nightly update channel: base-aware version comparator + verify/install
//! commands. The comparator mirrors `src/utils/version.ts::isUpdateNewer` and is
//! validated against the same matrix.

use semver::Version;

/// Returns the 10-digit nightly stamp if the prerelease is exactly `YYYYMMDDHH`.
fn parse_stamp(v: &Version) -> Option<u64> {
    let pre = v.pre.as_str();
    if pre.len() == 10 && pre.bytes().all(|b| b.is_ascii_digit()) {
        pre.parse::<u64>().ok()
    } else {
        None
    }
}

/// Base-aware "is `candidate` newer than `current`?" — see version.ts for the rule.
pub fn is_update_newer(candidate: &str, current: &str) -> bool {
    let (c, cur) = match (Version::parse(candidate), Version::parse(current)) {
        (Ok(c), Ok(cur)) => (c, cur),
        _ => return false,
    };
    let c_base = (c.major, c.minor, c.patch);
    let cur_base = (cur.major, cur.minor, cur.patch);
    if c_base != cur_base {
        return c_base > cur_base;
    }
    match (parse_stamp(&c), parse_stamp(&cur)) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (Some(cs), Some(curs)) => cs > curs,
        (None, None) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_update_newer;

    #[test]
    fn matrix() {
        let cases: &[(&str, &str, bool)] = &[
            ("0.11.5", "0.11.4-2026061406", true),
            ("0.11.4-2026061506", "0.11.4-2026061406", true),
            ("0.11.4-2026061406", "0.11.4-2026061506", false),
            ("0.11.4", "0.11.4-2026061406", false),
            ("0.11.4-2026061406", "0.11.4", true),
            ("0.11.5-2026070106", "0.11.4", true),
            ("0.11.4", "0.11.4", false),
            ("0.11.4-2026061406", "0.11.4-2026061406", false),
            ("0.11.4-rc.1", "0.11.4", false),
            ("", "0.11.4", false),
            ("0.11.4", "", false),
        ];
        for (cand, cur, want) in cases {
            assert_eq!(is_update_newer(cand, cur), *want, "is_update_newer({cand}, {cur})");
        }
    }
}
