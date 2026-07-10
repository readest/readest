use std::{
    fmt::{Display, Error, Formatter},
    ops::Deref,
};

use crate::{
    swift::{self, SwiftObject},
    Int, SRData, SRObject,
};

/// String type that can be shared between Swift and Rust.
///
/// ```rust
/// use swift_rs::{swift, SRString};
///
/// swift!(fn get_greeting(name: &SRString) -> SRString);
///
/// let greeting = unsafe { get_greeting(&"Brendan".into()) };
///
/// assert_eq!(greeting.as_str(), "Hello Brendan!");
/// ```
/// [_corresponding Swift code_](https://github.com/Brendonovich/swift-rs/blob/07269e511f1afb71e2fcfa89ca5d7338bceb20e8/tests/swift-pkg/doctests.swift#L56)
#[repr(transparent)]
pub struct SRString(SRData);

impl SRString {
    pub fn as_str(&self) -> &str {
        unsafe { std::str::from_utf8_unchecked(&self.0) }
    }
}

impl SwiftObject for SRString {
    type Shape = <SRData as SwiftObject>::Shape;

    fn get_object(&self) -> &SRObject<Self::Shape> {
        self.0.get_object()
    }
}

impl Deref for SRString {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl AsRef<[u8]> for SRString {
    fn as_ref(&self) -> &[u8] {
        self.0.as_ref()
    }
}

impl From<&str> for SRString {
    fn from(string: &str) -> Self {
        unsafe { swift::string_from_bytes(string.as_ptr(), string.len() as Int) }
    }
}

impl Display for SRString {
    fn fmt(&self, f: &mut Formatter) -> Result<(), Error> {
        self.as_str().fmt(f)
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for SRString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}
#[cfg(feature = "serde")]
impl<'a> serde::Deserialize<'a> for SRString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'a>,
    {
        let string = String::deserialize(deserializer)?;
        Ok(SRString::from(string.as_str()))
    }
}
