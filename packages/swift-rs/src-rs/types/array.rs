use std::{ops::Deref, ptr::NonNull};

use crate::swift::SwiftObject;

use super::SRObject;

/// Wrapper of [`SRArray`] exclusively for arrays of objects.
/// Equivalent to `SRObjectArray` in Swift.
// SRArray is wrapped in SRObject since the Swift implementation extends NSObject
pub type SRObjectArray<T> = SRObject<SRArray<SRObject<T>>>;

#[doc(hidden)]
#[repr(C)]
pub struct SRArrayImpl<T> {
    data: NonNull<T>,
    length: usize,
}

/// General array type for objects and scalars.
///
/// ## Returning Directly
///
/// When returning an `SRArray` from a Swift function,
/// you will need to wrap it in an `NSObject` class since
/// Swift doesn't permit returning generic types from `@_cdecl` functions.
/// To account for the wrapping `NSObject`, the array must be wrapped
/// in `SRObject` on the Rust side.
///
/// ```rust
/// use swift_rs::{swift, SRArray, SRObject, Int};
///
/// swift!(fn get_int_array() -> SRObject<SRArray<Int>>);
///
/// let array = unsafe { get_int_array() };
///
/// assert_eq!(array.as_slice(), &[1, 2, 3])
/// ```
/// [_corresponding Swift code_](https://github.com/Brendonovich/swift-rs/blob/07269e511f1afb71e2fcfa89ca5d7338bceb20e8/tests/swift-pkg/doctests.swift#L19)
///
/// ## Returning in a Struct fIeld
///
/// When returning an `SRArray` from a custom struct that is itself an `NSObject`,
/// the above work is already done for you.
/// Assuming your custom struct is already wrapped in `SRObject` in Rust,
/// `SRArray` will work normally.
///
/// ```rust
/// use swift_rs::{swift, SRArray, SRObject, Int};
///
/// #[repr(C)]
/// struct ArrayStruct {
///     array: SRArray<Int>
/// }
///
/// swift!(fn get_array_struct() -> SRObject<ArrayStruct>);
///
/// let data = unsafe { get_array_struct() };
///
/// assert_eq!(data.array.as_slice(), &[4, 5, 6]);
/// ```
/// [_corresponding Swift code_](https://github.com/Brendonovich/swift-rs/blob/07269e511f1afb71e2fcfa89ca5d7338bceb20e8/tests/swift-pkg/doctests.swift#L32)
#[repr(transparent)]
pub struct SRArray<T>(SRObject<SRArrayImpl<T>>);

impl<T> SRArray<T> {
    pub fn as_slice(&self) -> &[T] {
        self.0.as_slice()
    }
}

impl<T> SwiftObject for SRArray<T> {
    type Shape = SRArrayImpl<T>;

    fn get_object(&self) -> &SRObject<Self::Shape> {
        &self.0
    }
}

impl<T> Deref for SRArray<T> {
    type Target = [T];

    fn deref(&self) -> &Self::Target {
        self.0.as_slice()
    }
}

impl<T> SRArrayImpl<T> {
    pub fn as_slice(&self) -> &[T] {
        unsafe { std::slice::from_raw_parts(self.data.as_ref(), self.length) }
    }
}

#[cfg(feature = "serde")]
impl<T> serde::Serialize for SRArray<T>
where
    T: serde::Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeSeq;

        let mut seq = serializer.serialize_seq(Some(self.len()))?;
        for item in self.iter() {
            seq.serialize_element(item)?;
        }
        seq.end()
    }
}
