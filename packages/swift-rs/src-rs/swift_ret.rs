use crate::{swift::SwiftObject, *};
use std::ffi::c_void;

/// Identifies a type as being a valid return type from a Swift function.
/// For types that are objects which need extra retains,
/// the [`retain`](SwiftRet::retain) function will be re-implemented.
pub trait SwiftRet {
    /// Adds a retain to the value if possible
    ///
    /// # Safety
    /// Just don't use this.
    /// Let [`swift!`] handle it.
    unsafe fn retain(&self) {}
}

macro_rules! primitive_impl {
    ($($t:ty),+) => {
        $(impl SwiftRet for $t {
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

impl<T: SwiftObject> SwiftRet for Option<T> {
    unsafe fn retain(&self) {
        if let Some(v) = self {
            v.retain()
        }
    }
}

impl<T: SwiftObject> SwiftRet for T {
    unsafe fn retain(&self) {
        (*self).retain()
    }
}
