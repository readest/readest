use std::{io, path::Path};
use winreg::{
    enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_CREATED_NEW_KEY},
    RegKey,
};

const PROVIDER: &str = "{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}";
const THUMBNAIL_HANDLER: &str = "{e357fccd-a995-4576-b01f-234630154e96}";
const EXTENSIONS: [&str; 9] = [
    "epub", "mobi", "azw", "azw3", "kf8", "fb2", "cbz", "cbr", "pdf",
];
const PREFERENCE_KEY: &str = r"Software\Readest";
const PREFERENCE_VALUE: &str = "ExplorerThumbnails";

pub(super) fn get_explorer_thumbnails_enabled() -> Result<bool, String> {
    get_enabled(&RegKey::predef(HKEY_CURRENT_USER)).map_err(|err| err.to_string())
}

pub(super) fn set_explorer_thumbnails_enabled(enabled: bool) -> Result<(), String> {
    set_enabled(
        &RegKey::predef(HKEY_CURRENT_USER),
        &RegKey::predef(HKEY_CLASSES_ROOT),
        enabled,
    )
    .map_err(|err| err.to_string())?;

    // SHCNE_ASSOCCHANGED, SHCNF_IDLIST: refresh Explorer's association cache.
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event: i32, flags: u32, item1: *const (), item2: *const ());
    }
    unsafe { SHChangeNotify(0x08000000, 0, std::ptr::null(), std::ptr::null()) };
    Ok(())
}

fn get_enabled(user: &RegKey) -> io::Result<bool> {
    match user
        .open_subkey(PREFERENCE_KEY)
        .and_then(|key| key.get_value::<u32, _>(PREFERENCE_VALUE))
    {
        Ok(value) => Ok(value == 1),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

fn handler(root: &RegKey, path: &str) -> io::Result<Option<String>> {
    match root.open_subkey(path).and_then(|key| key.get_value("")) {
        Ok(value) => Ok(Some(value)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

fn set_enabled(user: &RegKey, classes: &RegKey, enabled: bool) -> io::Result<()> {
    if enabled {
        let dll = handler(classes, &format!(r"CLSID\{PROVIDER}\InprocServer32"))?;
        if !dll.is_some_and(|path| Path::new(&path).is_file()) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "Explorer thumbnails require an installed Readest thumbnail provider. Install or repair Readest using the Windows installer.",
            ));
        }
    }

    let mut registrations = Vec::new();
    let result = (|| {
        for extension in EXTENSIONS {
            let slot = format!(r".{extension}\ShellEx\{THUMBNAIL_HANDLER}");
            let user_slot = format!(r"Software\Classes\{slot}");
            let own_handler = handler(user, &user_slot)?;
            if enabled {
                // HKCR is merged. Check HKCU too, including when using isolated test roots.
                let existing = own_handler.or(handler(classes, &slot)?);
                if existing
                    .is_none_or(|value| value.is_empty() || value.eq_ignore_ascii_case(PROVIDER))
                {
                    let (key, disposition) = user.create_subkey(&user_slot)?;
                    let previous = match key.get_raw_value("") {
                        Ok(value) => Some(value),
                        Err(err) if err.kind() == io::ErrorKind::NotFound => None,
                        Err(err) => return Err(err),
                    };
                    let write = key.set_value("", &PROVIDER);
                    registrations.push((
                        user_slot,
                        key,
                        previous,
                        disposition == REG_CREATED_NEW_KEY,
                    ));
                    write?;
                }
            } else if own_handler.is_some_and(|value| value.eq_ignore_ascii_case(PROVIDER)) {
                let key = user.open_subkey_with_flags(&user_slot, KEY_READ | KEY_WRITE)?;
                let previous = key.get_raw_value("")?;
                let removal = (|| {
                    key.delete_value("")?;
                    // Preserve any unrelated metadata/subkeys left in the handler slot.
                    let info = key.query_info()?;
                    if info.values == 0 && info.sub_keys == 0 {
                        user.delete_subkey(&user_slot)?;
                    }
                    Ok::<(), io::Error>(())
                })();
                registrations.push((user_slot, key, Some(previous), false));
                removal?;
            }
        }

        user.create_subkey(PREFERENCE_KEY)?
            .0
            .set_value(PREFERENCE_VALUE, &u32::from(enabled))
    })();
    if let Err(err) = result {
        let mut rollback_error = None;
        for (path, key, previous, created) in registrations.into_iter().rev() {
            let restored = match previous {
                Some(value) if enabled => key.set_raw_value("", &value),
                Some(value) => {
                    drop(key);
                    user.create_subkey(&path)
                        .and_then(|(key, _)| key.set_raw_value("", &value))
                }
                None => match key.delete_value("") {
                    Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
                    result => result,
                },
            }
            .and_then(|()| {
                if created {
                    user.delete_subkey(&path)?;
                }
                Ok(())
            });
            if let Err(err) = restored {
                rollback_error = Some(err);
            }
        }
        return Err(match rollback_error {
            Some(rollback) => {
                io::Error::other(format!("{err}; thumbnail rollback failed: {rollback}"))
            }
            None => err,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use winreg::enums::{HKEY_CURRENT_USER, REG_DWORD};

    const OTHER_PROVIDER: &str = "{00000000-0000-0000-0000-000000000001}";
    const PREVIEW_HANDLER: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";

    struct Registry {
        path: String,
        user: RegKey,
        classes: RegKey,
    }

    impl Registry {
        fn new() -> Self {
            static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
            let path = format!(
                r"Software\ReadestThumbnailTests\{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            );
            let (root, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(&path)
                .unwrap();
            let (user, _) = root.create_subkey("User").unwrap();
            let (classes, _) = root.create_subkey("MergedClasses").unwrap();
            Self {
                path,
                user,
                classes,
            }
        }

        fn install(&self) {
            // A real existing file stands in for the installer-owned DLL.
            self.classes
                .create_subkey(format!(r"CLSID\{PROVIDER}\InprocServer32"))
                .unwrap()
                .0
                .set_value("", &std::env::current_exe().unwrap().to_str().unwrap())
                .unwrap();
        }

        fn slot(extension: &str) -> String {
            format!(r".{extension}\ShellEx\{THUMBNAIL_HANDLER}")
        }

        fn user_handler(&self, extension: &str) -> Option<String> {
            self.user
                .open_subkey(format!(r"Software\Classes\{}", Self::slot(extension)))
                .and_then(|key| key.get_value(""))
                .ok()
        }

        fn preference(&self) -> Option<u32> {
            self.user
                .open_subkey(PREFERENCE_KEY)
                .and_then(|key| key.get_value(PREFERENCE_VALUE))
                .ok()
        }
    }

    impl Drop for Registry {
        fn drop(&mut self) {
            RegKey::predef(HKEY_CURRENT_USER)
                .delete_subkey_all(&self.path)
                .unwrap();
        }
    }

    #[test]
    fn preference_defaults_off_and_only_dword_one_is_enabled() {
        let registry = Registry::new();
        assert!(!get_enabled(&registry.user).unwrap());
        assert!(
            registry.user.open_subkey(PREFERENCE_KEY).is_err(),
            "reading must not write a preference"
        );
        let key = registry.user.create_subkey(PREFERENCE_KEY).unwrap().0;
        for (value, expected) in [(0_u32, false), (1, true), (2, false)] {
            key.set_value(PREFERENCE_VALUE, &value).unwrap();
            assert_eq!(
                get_enabled(&registry.user).unwrap(),
                expected,
                "DWORD {value}"
            );
        }
        key.set_value(PREFERENCE_VALUE, &"1").unwrap();
        assert!(
            get_enabled(&registry.user).is_err(),
            "invalid registry types must not be treated as enabled"
        );
    }

    #[test]
    fn enable_registers_all_free_extensions_and_persists_dword() {
        let registry = Registry::new();
        registry.install();
        // Cover absent keys, absent default values, empty values and our CLSID.
        registry
            .classes
            .create_subkey(Registry::slot("mobi"))
            .unwrap();
        registry
            .classes
            .create_subkey(Registry::slot("azw"))
            .unwrap()
            .0
            .set_value("", &"")
            .unwrap();
        registry
            .classes
            .create_subkey(Registry::slot("azw3"))
            .unwrap()
            .0
            .set_value("", &PROVIDER.to_lowercase())
            .unwrap();
        set_enabled(&registry.user, &registry.classes, true).unwrap();
        for extension in EXTENSIONS {
            assert_eq!(
                registry.user_handler(extension).as_deref(),
                Some(PROVIDER),
                "missing .{extension} registration"
            );
        }
        assert!(get_enabled(&registry.user).unwrap());
        let key = registry.user.open_subkey(PREFERENCE_KEY).unwrap();
        assert_eq!(
            key.get_raw_value(PREFERENCE_VALUE).unwrap().vtype,
            REG_DWORD
        );
        set_enabled(&registry.user, &registry.classes, true).unwrap();
    }

    #[test]
    fn enable_preserves_other_providers_and_preview_slots() {
        let registry = Registry::new();
        registry.install();
        registry
            .classes
            .create_subkey(Registry::slot("pdf"))
            .unwrap()
            .0
            .set_value("", &OTHER_PROVIDER)
            .unwrap();
        let user_slot = format!(r"Software\Classes\{}", Registry::slot("cbz"));
        registry
            .user
            .create_subkey(&user_slot)
            .unwrap()
            .0
            .set_value("", &OTHER_PROVIDER)
            .unwrap();
        let preview = format!(r"Software\Classes\.epub\ShellEx\{PREVIEW_HANDLER}");
        registry
            .user
            .create_subkey(&preview)
            .unwrap()
            .0
            .set_value("", &PROVIDER)
            .unwrap();
        set_enabled(&registry.user, &registry.classes, true).unwrap();
        assert_eq!(
            registry.user_handler("pdf"),
            None,
            "must not shadow a merged provider"
        );
        assert_eq!(
            registry.user_handler("cbz").as_deref(),
            Some(OTHER_PROVIDER)
        );
        assert_eq!(
            registry
                .classes
                .open_subkey(Registry::slot("pdf"))
                .unwrap()
                .get_value::<String, _>("")
                .unwrap(),
            OTHER_PROVIDER
        );
        assert_eq!(
            registry
                .user
                .open_subkey(preview)
                .unwrap()
                .get_value::<String, _>("")
                .unwrap(),
            PROVIDER
        );
        assert_eq!(registry.user_handler("epub").as_deref(), Some(PROVIDER));
    }

    #[test]
    fn disable_removes_only_our_user_slots_without_installation() {
        let registry = Registry::new();
        for extension in EXTENSIONS {
            registry
                .user
                .create_subkey(format!(r"Software\Classes\{}", Registry::slot(extension)))
                .unwrap()
                .0
                .set_value("", &PROVIDER.to_lowercase())
                .unwrap();
        }
        registry
            .user
            .create_subkey(format!(r"Software\Classes\{}", Registry::slot("pdf")))
            .unwrap()
            .0
            .set_value("", &OTHER_PROVIDER)
            .unwrap();
        registry
            .classes
            .create_subkey(Registry::slot("epub"))
            .unwrap()
            .0
            .set_value("", &PROVIDER)
            .unwrap();
        let preview = format!(r"Software\Classes\.epub\ShellEx\{PREVIEW_HANDLER}");
        registry
            .user
            .create_subkey(&preview)
            .unwrap()
            .0
            .set_value("", &PROVIDER)
            .unwrap();
        set_enabled(&registry.user, &registry.classes, false).unwrap();
        for extension in EXTENSIONS.into_iter().filter(|ext| *ext != "pdf") {
            assert!(
                registry
                    .user
                    .open_subkey(format!(r"Software\Classes\{}", Registry::slot(extension)))
                    .is_err(),
                "own .{extension} slot must be removed"
            );
        }
        assert_eq!(
            registry.user_handler("pdf").as_deref(),
            Some(OTHER_PROVIDER)
        );
        assert_eq!(
            registry
                .classes
                .open_subkey(Registry::slot("epub"))
                .unwrap()
                .get_value::<String, _>("")
                .unwrap(),
            PROVIDER
        );
        assert_eq!(
            registry
                .user
                .open_subkey(preview)
                .unwrap()
                .get_value::<String, _>("")
                .unwrap(),
            PROVIDER
        );
        assert_eq!(registry.preference(), Some(0));
        set_enabled(&registry.user, &registry.classes, false).unwrap();
    }

    #[test]
    fn enable_requires_registered_existing_dll_and_does_not_write_on_failure() {
        let registry = Registry::new();
        assert!(
            set_enabled(&registry.user, &registry.classes, true).is_err(),
            "portable app must not silently enable thumbnails"
        );
        registry
            .classes
            .create_subkey(format!(r"CLSID\{PROVIDER}\InprocServer32"))
            .unwrap()
            .0
            .set_value("", &r"C:\missing-readest-thumbnail.dll")
            .unwrap();
        assert!(
            set_enabled(&registry.user, &registry.classes, true).is_err(),
            "missing installed DLL must fail"
        );
        assert_eq!(registry.preference(), None);
        assert_eq!(registry.user_handler("epub"), None);
    }

    #[test]
    fn failed_registry_mutation_keeps_previous_preference() {
        let registry = Registry::new();
        registry.install();
        registry
            .user
            .create_subkey(PREFERENCE_KEY)
            .unwrap()
            .0
            .set_value(PREFERENCE_VALUE, &0_u32)
            .unwrap();
        registry
            .user
            .create_subkey(format!(r"Software\Classes\{}", Registry::slot("mobi")))
            .unwrap()
            .0
            .set_value("", &"")
            .unwrap();
        registry
            .user
            .create_subkey(format!(r"Software\Classes\{}", Registry::slot("azw")))
            .unwrap()
            .0
            .set_value("", &PROVIDER.to_lowercase())
            .unwrap();
        let metadata = registry
            .user
            .create_subkey(format!(r"Software\Classes\{}", Registry::slot("kf8")))
            .unwrap()
            .0;
        metadata.set_value("Unrelated", &"preserve me").unwrap();
        registry
            .classes
            .create_subkey(Registry::slot("pdf"))
            .unwrap()
            .0
            .set_value("", &42_u32)
            .unwrap();
        assert!(
            set_enabled(&registry.user, &registry.classes, true).is_err(),
            "invalid handler data must fail without replacing it"
        );
        assert_eq!(
            registry.preference(),
            Some(0),
            "preference must be written after registry mutations succeed"
        );
        assert_eq!(registry.user_handler("pdf"), None);
        for extension in EXTENSIONS {
            let previous = match extension {
                "mobi" => Some(String::new()),
                "azw" => Some(PROVIDER.to_lowercase()),
                _ => None,
            };
            assert_eq!(
                registry.user_handler(extension),
                previous,
                "failed enable must restore .{extension} registration"
            );
        }
        assert_eq!(
            metadata.get_value::<String, _>("Unrelated").unwrap(),
            "preserve me"
        );
        registry
            .user
            .create_subkey(PREFERENCE_KEY)
            .unwrap()
            .0
            .set_value(PREFERENCE_VALUE, &1_u32)
            .unwrap();
        registry
            .user
            .create_subkey(format!(r"Software\Classes\{}", Registry::slot("pdf")))
            .unwrap()
            .0
            .set_value("", &42_u32)
            .unwrap();
        assert!(set_enabled(&registry.user, &registry.classes, false).is_err());
        assert_eq!(
            registry.preference(),
            Some(1),
            "a failed disable must retain the preference too"
        );
        assert_eq!(
            registry.user_handler("azw"),
            Some(PROVIDER.to_lowercase()),
            "failed disable must recreate a removed slot with its original value"
        );
    }
}
