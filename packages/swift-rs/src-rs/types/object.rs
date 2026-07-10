use crate::swift::{self, SwiftObject};
use std::{ffi::c_void, ops::Deref, ptr::NonNull};

#[doc(hidden)]
#[repr(C)]
pub struct SRObjectImpl<T> {
    _nsobject_offset: u8,
    data: T,
}

/// Wrapper for arbitrary `NSObject` types.
///
/// When returning an `NSObject`, its Rust type must be wrapped in `SRObject`.
/// The type must also be annotated with `#[repr(C)]` to ensure its memory layout
/// is identical to its Swift counterpart's.
///
/// ```rust
/// use swift_rs::{swift, SRObject, Int, Bool};
///
/// #[repr(C)]
/// struct CustomObject {
///     a: Int,
///     b: Bool
/// }
///
/// swift!(fn get_custom_object() -> SRObject<CustomObject>);
///
/// let value = unsafe { get_custom_object() };
///
/// let reference: &CustomObject = value.as_ref();
/// ```
/// [_corresponding Swift code_](https://github.com/Brendonovich/swift-rs/blob/07269e511f1afb71e2fcfa89ca5d7338bceb20e8/tests/swift-pkg/doctests.swift#L49)
#[repr(transparent)]
pub struct SRObject<T>(pub(crate) NonNull<SRObjectImpl<T>>);

impl<T> SwiftObject for SRObject<T> {
    type Shape = T;

    fn get_object(&self) -> &SRObject<Self::Shape> {
        self
    }
}

impl<T> Deref for SRObject<T> {
    type Target = T;

    fn deref(&self) -> &T {
        unsafe { &self.0.as_ref().data }
    }
}

impl<T> AsRef<T> for SRObject<T> {
    fn as_ref(&self) -> &T {
        self
    }
}

impl<T> Drop for SRObject<T> {
    fn drop(&mut self) {
        unsafe { swift::release_object(self.0.as_ref() as *const _ as *const c_void) }
    }
}

#[cfg(feature = "serde")]
impl<T> serde::Serialize for SRObject<T>
where
    T: serde::Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.deref().serialize(serializer)
    }
}
