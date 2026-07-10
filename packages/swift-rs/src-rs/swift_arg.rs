use std::ffi::c_void;

use crate::{swift::SwiftObject, *};

/// Identifies a type as being a valid argument in a Swift function.
pub trait SwiftArg<'a> {
    type ArgType;

    /// Creates a swift-compatible version of the argument.
    /// For primitives this just returns `self`,
    /// but for [`SwiftObject`] types it wraps them in [`SwiftRef`].
    ///
    /// This function is called within the [`swift!`] macro.
    ///
    /// # Safety
    ///
    /// Creating a [`SwiftRef`] is inherently unsafe,
    /// but is reliable if using the [`swift!`] macro,
    /// so it is not advised to call this function manually.
    unsafe fn as_arg(&'a self) -> Self::ArgType;
}

macro_rules! primitive_impl {
    ($($t:ty),+) => {
        $(impl<'a> SwiftArg<'a> for $t {
            type ArgType = $t;

            unsafe fn as_arg(&'a self) -> Self::ArgType {
                *self
            }
        })+
    };
}

primitive_impl!(
    Bool,
    Int,
    Int8,
    Int16,
    Int32,
    Int64,
    UInt,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Float32,
    Float64,
    *const c_void,
    *mut c_void,
    *const u8,
    ()
);

macro_rules! ref_impl {
    ($($t:ident $(<$($gen:ident),+>)?),+) => {
        $(impl<'a $($(, $gen: 'a),+)?> SwiftArg<'a> for $t$(<$($gen),+>)? {
            type ArgType = SwiftRef<'a, $t$(<$($gen),+>)?>;

            unsafe fn as_arg(&'a self) -> Self::ArgType {
                self.swift_ref()
            }
        })+
    };
}

ref_impl!(SRObject<T>, SRArray<T>, SRData, SRString);

impl<'a, T: SwiftArg<'a>> SwiftArg<'a> for &T {
    type ArgType = T::ArgType;

    unsafe fn as_arg(&'a self) -> Self::ArgType {
        (*self).as_arg()
    }
}
