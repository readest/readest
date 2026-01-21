use std::cell::RefCell;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_authentication_services::{
    ASAuthorization, ASAuthorizationAppleIDCredential, ASAuthorizationAppleIDProvider,
    ASAuthorizationController, ASAuthorizationControllerDelegate, ASAuthorizationRequest,
    ASAuthorizationScopeEmail, ASAuthorizationScopeFullName,
};
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSString};

use serde::{Deserialize, Serialize};
use serde_json::json;

use tauri::{command, AppHandle, Emitter};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleIDAuthorizationRequest {
    pub scope: Vec<String>,
    pub nonce: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleIDAuthorizationResponse {
    pub user_identifier: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub email: Option<String>,
    pub authorization_code: Option<String>,
    pub identity_token: Option<String>,
    pub state: Option<String>,
}

thread_local! {
    static APPLE_SIGN_IN_DELEGATE: RefCell<Option<Retained<ASAuthorizationControllerDelegateImpl>>> = const { RefCell::new(None) };
    static AUTHORIZATION_CONTROLLER: RefCell<Option<Retained<ASAuthorizationController>>> = const { RefCell::new(None) };
}

#[derive(Clone)]
pub struct Ivars {
    app: AppHandle,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ASAuthorizationControllerDelegateImpl"]
    #[ivars = Ivars]
    pub struct ASAuthorizationControllerDelegateImpl;

    unsafe impl NSObjectProtocol for ASAuthorizationControllerDelegateImpl {}

    unsafe impl ASAuthorizationControllerDelegate for ASAuthorizationControllerDelegateImpl {
        #[unsafe(method(authorizationController:didCompleteWithAuthorization:))]
        #[allow(non_snake_case)]
        unsafe fn authorizationController_didCompleteWithAuthorization(
            &self,
            _controller: &ASAuthorizationController,
            authorization: &ASAuthorization,
        ) {
            if let Ok(credential) = authorization
                .credential()
                .downcast::<ASAuthorizationAppleIDCredential>()
            {
                let user_identifier = {
                    let user = credential.user();
                    if !user.is_empty() {
                        Some(user.to_string())
                    } else {
                        None
                    }
                };
                let given_name = credential
                    .fullName()
                    .and_then(|name| name.givenName())
                    .map(|nsstr| nsstr.to_string());
                let family_name = credential
                    .fullName()
                    .and_then(|name| name.familyName())
                    .map(|nsstr| nsstr.to_string());
                let email = credential.email().map(|nsstr| nsstr.to_string());

                let authorization_code = credential
                    .authorizationCode()
                    .and_then(|code_data| String::from_utf8(code_data.to_vec()).ok());

                let identity_token = credential
                    .identityToken()
                    .and_then(|token_data| String::from_utf8(token_data.to_vec()).ok());

                let state = credential.state().map(|nsstr| nsstr.to_string());

                let resp = AppleIDAuthorizationResponse {
                    user_identifier,
                    given_name,
                    family_name,
                    email,
                    authorization_code,
                    identity_token,
                    state,
                };
                let _ = self.ivars().app.emit("apple-sign-in-complete", json!(resp));
                log::info!("Apple authorization complete");
            } else {
                let _ = self
                    .ivars()
                    .app
                    .emit("apple-sign-in-error", "Invalid credential type");
                log::error!("Invalid credential type received");
            }
        }

        #[unsafe(method(authorizationController:didCompleteWithError:))]
        #[allow(non_snake_case)]
        unsafe fn authorizationController_didCompleteWithError(
            &self,
            _controller: &ASAuthorizationController,
            error: &NSError,
        ) {
            let code = error.code();
            let description = error.localizedDescription().to_string();
            let _ = self.ivars().app.emit(
                "apple-sign-in-error",
                json!({
                    "code": code,
                    "description": description,
                }),
            );

            log::error!(
                "Authorization error: code={}, description={}",
                code,
                description
            );
        }
    }
);

impl ASAuthorizationControllerDelegateImpl {
    fn new(app: AppHandle) -> Retained<Self> {
        let mtm = MainThreadMarker::new().expect("must run on main thread");
        let this = Self::alloc(mtm).set_ivars(Ivars { app });
        unsafe { msg_send![super(this), init] }
    }
}

#[command]
pub fn start_apple_sign_in(app: AppHandle, payload: AppleIDAuthorizationRequest) {
    unsafe {
        let provider = ASAuthorizationAppleIDProvider::new();
        let request = provider.createRequest();

        if let Some(ref nonce) = payload.nonce {
            let ns_nonce = NSString::from_str(nonce);
            request.setNonce(Some(&ns_nonce));
        }

        if let Some(ref state) = payload.state {
            let ns_state = NSString::from_str(state);
            request.setState(Some(&ns_state));
        }

        let mut scopes = Vec::new();
        for scope in payload.scope.iter() {
            match scope.as_str() {
                "email" => scopes.push(ASAuthorizationScopeEmail),
                "fullName" => scopes.push(ASAuthorizationScopeFullName),
                _ => {
                    log::warn!("[Apple Sign-In] Unsupported scope: {}", scope);
                }
            }
        }
        if !scopes.is_empty() {
            request.setRequestedScopes(Some(&*NSArray::from_slice(&scopes)));
        }

        let auth_request = &request as &ASAuthorizationRequest;
        let controller = ASAuthorizationController::initWithAuthorizationRequests(
            ASAuthorizationController::alloc(),
            &NSArray::from_slice(&[auth_request]),
        );

        let delegate = ASAuthorizationControllerDelegateImpl::new(app.clone());
        APPLE_SIGN_IN_DELEGATE.with(|cell| {
            *cell.borrow_mut() = Some(delegate.clone());
        });

        AUTHORIZATION_CONTROLLER.with(|cell| {
            *cell.borrow_mut() = Some(controller.clone());
        });

        controller.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));

        log::info!("Starting Apple Sign-In authorization request");
        controller.performRequests();
    }
}
