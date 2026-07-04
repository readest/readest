use std::ffi::c_void;

use crate::*;

/// Reference to an `NSObject` for internal use by [`swift!`].
#[must_use = "A Ref MUST be sent over to the Swift side"]
#[repr(transparent)]
pub struct SwiftRef<'a, T: SwiftObject>(&'a SRObjectImpl<T::Shape>);

impl<'a, T: SwiftObject> SwiftRef<'a, T> {
    pub(crate) unsafe fn retain(&self) {
        retain_object(self.0 as *const _ as *const c_void)
    }
}

/// A type that is represented as an `NSObject` in Swift.
pub trait SwiftObject {
    type Shape;

    /// Gets a reference to the `SRObject` at the root of a `SwiftObject`
    fn get_object(&self) -> &SRObject<Self::Shape>;

    /// Creates a [`SwiftRef`] for an object which can be used when calling a Swift function.
    /// This function should never be called manually,
    /// instead you should rely on the [`swift!`] macro to call it for you.
    ///
    /// # Safety
    /// This function converts the [`NonNull`](std::ptr::NonNull)
    /// inside an [`SRObject`] into a reference,
    /// implicitly assuming that the pointer is still valid.
    /// The inner pointer is private,
    /// and the returned [`SwiftRef`] is bound to the lifetime of the original [`SRObject`],
    /// so if you use `swift-rs` as normal this function should be safe.
    unsafe fn swift_ref(&self) -> SwiftRef<Self>
    where
        Self: Sized,
    {
        SwiftRef(self.get_object().0.as_ref())
    }

    /// Adds a retain to an object.
    ///
    /// # Safety
    /// Just don't call this, let [`swift!`] handle it for you.
    unsafe fn retain(&self)
    where
        Self: Sized,
    {
        self.swift_ref().retain()
    }
}

swift!(pub(crate) fn retain_object(obj: *const c_void));
swift!(pub(crate) fn release_object(obj: *const c_void));
swift!(pub(crate) fn data_from_bytes(data: *const u8, size: Int) -> SRData);
swift!(pub(crate) fn string_from_bytes(data: *const u8, size: Int) -> SRString);

/// Declares a function defined in a swift library.
/// As long as this macro is used, retain counts of arguments
/// and return values will be correct.
///
/// Use this macro as if the contents were going directly
/// into an `extern "C"` block.
///
/// ```
/// use swift_rs::*;
///
/// swift!(fn echo(string: &SRString) -> SRString);
///
/// let string: SRString = "test".into();
/// let result = unsafe { echo(&string) };
///
/// assert_eq!(result.as_str(), string.as_str())
/// ```
///
/// # Details
///
/// Internally this macro creates a wrapping function around an `extern "C"` block
/// that represents the actual Swift function. This is done in order to restrict the types
/// that can be used as arguments and return types, and to ensure that retain counts of returned
/// values are appropriately balanced.
#[macro_export]
macro_rules! swift {
    ($vis:vis fn $name:ident $(<$($lt:lifetime),+>)? ($($arg:ident: $arg_ty:ty),*) $(-> $ret:ty)?) => {
        $vis unsafe fn $name $(<$($lt),*>)? ($($arg: $arg_ty),*) $(-> $ret)? {
            extern "C" {
                fn $name $(<$($lt),*>)? ($($arg: <$arg_ty as $crate::SwiftArg>::ArgType),*) $(-> $ret)?;
            }

            let res = {
                $(let $arg = $crate::SwiftArg::as_arg(&$arg);)*

                $name($($arg),*)
            };

            $crate::SwiftRet::retain(&res);

            res
        }
    };
}
