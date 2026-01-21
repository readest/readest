use std::ffi::CStr;
use std::marker::PhantomData;
use std::sync::{Arc, Mutex};

use block::ConcreteBlock;
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel, BOOL, YES};
use objc::{class, msg_send, sel, sel_impl};
use objc_foundation::{INSString, NSString};
use objc_id::Id;
use serde::{Deserialize, Serialize};

use tauri::{
    command,
    plugin::{Builder, TauriPlugin},
    Emitter, Manager, Runtime, State, Window,
};

pub struct ThreadSafeObjcPointer(*mut Object, PhantomData<*mut Object>);

unsafe impl Send for ThreadSafeObjcPointer {}
unsafe impl Sync for ThreadSafeObjcPointer {}

impl ThreadSafeObjcPointer {
    pub fn new(ptr: *mut Object) -> Self {
        Self(ptr, PhantomData)
    }

    pub fn as_ptr(&self) -> *mut Object {
        self.0
    }

    pub fn is_null(&self) -> bool {
        self.0.is_null()
    }
}

#[derive(Default)]
pub struct AuthSession {
    auth_session: Option<ThreadSafeObjcPointer>,
}

impl Drop for AuthSession {
    fn drop(&mut self) {
        if let Some(session) = &self.auth_session {
            if !session.is_null() {
                unsafe {
                    let _: () = msg_send![session.as_ptr(), cancel];
                }
            }
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SafariAuthRequestArgs {
    auth_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    redirect_url: String,
}

fn setup_presentation_context_provider() -> &'static Class {
    let class_name = "TauriPresentationContextProvider";
    let mut decl = match Class::get(class_name) {
        Some(class) => return class,
        None => ClassDecl::new(class_name, class!(NSObject)).unwrap(),
    };

    extern "C" fn presentation_anchor_for_web_auth_session(
        this: &Object,
        _sel: Sel,
        _session: *mut Object,
    ) -> *mut Object {
        unsafe {
            let window: *mut Object = *this.get_ivar("window");
            window
        }
    }

    unsafe {
        decl.add_ivar::<*mut Object>("window");

        let sel = sel!(presentationAnchorForWebAuthenticationSession:);
        decl.add_method(
            sel,
            presentation_anchor_for_web_auth_session
                as extern "C" fn(&Object, Sel, *mut Object) -> *mut Object,
        );
    }

    decl.register()
}

unsafe fn create_provider(window: *mut Object) -> *mut Object {
    let class = setup_presentation_context_provider();
    let provider: *mut Object = msg_send![class, alloc];
    let provider: *mut Object = msg_send![provider, init];

    (*provider).set_ivar("window", window);

    provider
}

unsafe fn nsstring_to_string(ns_string: *mut Object) -> String {
    if ns_string.is_null() {
        return String::new();
    }

    let utf8_ptr: *const i8 = msg_send![ns_string, UTF8String];
    if utf8_ptr.is_null() {
        return String::new();
    }

    CStr::from_ptr(utf8_ptr).to_string_lossy().into_owned()
}

#[command]
pub async fn auth_with_safari<R: Runtime>(
    window: Window<R>,
    state: State<'_, Arc<Mutex<AuthSession>>>,
    payload: SafariAuthRequestArgs,
) -> Result<AuthResult, String> {
    let auth_url_str = NSString::from_str(&payload.auth_url);
    let url_class = Class::get("NSURL").unwrap();
    let auth_url: Id<Object> = unsafe {
        let url: *mut Object = msg_send![url_class, URLWithString:auth_url_str];
        if url.is_null() {
            return Err("Failed to create URL".to_string());
        }
        Id::from_ptr(url)
    };

    let auth_session_class = match Class::get("ASWebAuthenticationSession") {
        Some(class) => class,
        None => {
            return Err(
                "ASWebAuthenticationSession class not found. This requires macOS 10.15+"
                    .to_string(),
            )
        }
    };

    let window_clone = window.clone();
    let state_clone = Arc::clone(&*state);
    let completion_block =
        ConcreteBlock::new(move |callback_url: *mut Object, error: *mut Object| {
            let mut auth_session = match state_clone.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            if !error.is_null() {
                unsafe {
                    let description: *mut Object = msg_send![error, localizedDescription];
                    let error_description = nsstring_to_string(description);
                    log::error!("Auth session error: {}", error_description);
                }
                return;
            }

            if !callback_url.is_null() {
                let url_string_value = unsafe {
                    let abs_str: *mut Object = msg_send![callback_url, absoluteString];
                    nsstring_to_string(abs_str)
                };

                log::info!("Auth session callback URL: {}", url_string_value);

                if let Some(session) = &auth_session.auth_session {
                    unsafe {
                        let _: () = msg_send![session.as_ptr(), cancel];
                    }
                }

                auth_session.auth_session = None;

                let result = AuthResult {
                    redirect_url: url_string_value,
                };

                let _ = window_clone.emit("safari-auth-complete", result);
            }
        });

    let completion_block = completion_block.copy();

    let callback_scheme = NSString::from_str("readest");
    let auth_session_ptr: *mut Object = unsafe {
        let alloc: *mut Object = msg_send![auth_session_class, alloc];
        if alloc.is_null() {
            return Err("Failed to allocate ASWebAuthenticationSession".to_string());
        }

        let init: *mut Object = msg_send![
            alloc,
            initWithURL:auth_url
            callbackURLScheme:callback_scheme
            completionHandler:&*completion_block
        ];

        if init.is_null() {
            return Err("Failed to initialize ASWebAuthenticationSession".to_string());
        }
        init
    };

    unsafe {
        match window.ns_window() {
            Ok(ns_window) => {
                let ns_window = ns_window as *mut Object;
                let provider = create_provider(ns_window);

                let _: () = msg_send![auth_session_ptr, setPresentationContextProvider:provider];
            }
            Err(err) => {
                log::warn!("Failed to get NSWindow for presentation context: {}", err);
            }
        }
    }

    let started: BOOL = unsafe { msg_send![auth_session_ptr, start] };

    log::info!("Auth session start result: {}", started == YES);

    if started != YES {
        return Err("Failed to start authentication session".to_string());
    }

    let mut auth_session_guard = state.lock().unwrap();
    auth_session_guard.auth_session = Some(ThreadSafeObjcPointer::new(auth_session_ptr));

    Ok(AuthResult {
        redirect_url: "pending".to_string(),
    })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("safari_auth")
        .setup(|app, _| {
            app.manage(Arc::new(Mutex::new(AuthSession::default())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![auth_with_safari])
        .build()
}
