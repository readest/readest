use crate::{
    swift::{self, SwiftObject},
    Int,
};

use super::{array::SRArray, SRObject};

use std::ops::Deref;

type Data = SRArray<u8>;

/// Convenience type for working with byte buffers,
/// analagous to `SRData` in Swift.
///
/// ```rust
/// use swift_rs::{swift, SRData};
///
/// swift!(fn get_data() -> SRData);
///
/// let data = unsafe { get_data() };
///
/// assert_eq!(data.as_ref(), &[1, 2, 3])
/// ```
/// [_corresponding Swift code_](https://github.com/Brendonovich/swift-rs/blob/07269e511f1afb71e2fcfa89ca5d7338bceb20e8/tests/swift-pkg/doctests.swift#L68)
#[repr(transparent)]
pub struct SRData(SRObject<Data>);

impl SRData {
    pub fn as_slice(&self) -> &[u8] {
        self
    }

    pub fn to_vec(&self) -> Vec<u8> {
        self.as_slice().to_vec()
    }
}

impl SwiftObject for SRData {
    type Shape = Data;

    fn get_object(&self) -> &SRObject<Self::Shape> {
        &self.0
    }
}

impl Deref for SRData {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AsRef<[u8]> for SRData {
    fn as_ref(&self) -> &[u8] {
        self
    }
}

impl From<&[u8]> for SRData {
    fn from(value: &[u8]) -> Self {
        unsafe { swift::data_from_bytes(value.as_ptr(), value.len() as Int) }
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for SRData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_bytes(self)
    }
}
