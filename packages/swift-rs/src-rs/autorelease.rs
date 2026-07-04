/// Run code with its own autorelease pool. Semantically, this is identical
/// to [`@autoreleasepool`](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MemoryMgmt/Articles/mmAutoreleasePools.html)
/// in Objective-C
///
///
/// ```no_run
/// use swift_rs::autoreleasepool;
///
/// autoreleasepool!({
///     // do something memory intensive stuff
/// })
/// ```
#[macro_export]
macro_rules! autoreleasepool {
    ( $expr:expr ) => {{
        extern "C" {
            fn objc_autoreleasePoolPush() -> *mut std::ffi::c_void;
            fn objc_autoreleasePoolPop(context: *mut std::ffi::c_void);
        }

        let pool = unsafe { objc_autoreleasePoolPush() };
        let r = { $expr };
        unsafe { objc_autoreleasePoolPop(pool) };
        r
    }};
}
