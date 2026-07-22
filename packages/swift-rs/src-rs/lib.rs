//! Call Swift functions from Rust with ease!
#![cfg_attr(docsrs, feature(doc_cfg))]

mod autorelease;
mod swift;
mod swift_arg;
mod swift_ret;
mod types;

pub use autorelease::*;
pub use swift::*;
pub use swift_arg::*;
pub use swift_ret::*;
pub use types::*;

#[cfg(feature = "build")]
#[cfg_attr(docsrs, doc(cfg(feature = "build")))]
mod build;
#[cfg(feature = "build")]
pub use build::*;
