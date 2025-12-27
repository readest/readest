use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_bridge);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<NativeBridge<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.readest.native_bridge", "NativeBridgePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_native_bridge)?;
    Ok(NativeBridge(handle))
}

/// Access to the native-bridge APIs.
pub struct NativeBridge<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> NativeBridge<R> {
    pub fn auth_with_safari(&self, payload: AuthRequest) -> crate::Result<AuthResponse> {
        self.0
            .run_mobile_plugin("auth_with_safari", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn auth_with_custom_tab(&self, payload: AuthRequest) -> crate::Result<AuthResponse> {
        self.0
            .run_mobile_plugin("auth_with_custom_tab", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn copy_uri_to_path(&self, payload: CopyURIRequest) -> crate::Result<CopyURIResponse> {
        self.0
            .run_mobile_plugin("copy_uri_to_path", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn use_background_audio(&self, payload: UseBackgroundAudioRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("use_background_audio", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn install_package(
        &self,
        payload: InstallPackageRequest,
    ) -> crate::Result<InstallPackageResponse> {
        self.0
            .run_mobile_plugin("install_package", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn set_system_ui_visibility(
        &self,
        payload: SetSystemUIVisibilityRequest,
    ) -> crate::Result<SetSystemUIVisibilityResponse> {
        self.0
            .run_mobile_plugin("set_system_ui_visibility", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_status_bar_height(&self) -> crate::Result<GetStatusBarHeightResponse> {
        self.0
            .run_mobile_plugin("get_status_bar_height", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_sys_fonts_list(&self) -> crate::Result<GetSysFontsListResponse> {
        self.0
            .run_mobile_plugin("get_sys_fonts_list", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn intercept_keys(&self, payload: InterceptKeysRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("intercept_keys", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn lock_screen_orientation(
        &self,
        payload: LockScreenOrientationRequest,
    ) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("lock_screen_orientation", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn iap_is_available(&self) -> crate::Result<IAPIsAvailableResponse> {
        self.0
            .run_mobile_plugin("iap_is_available", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn iap_initialize(
        &self,
        payload: IAPInitializeRequest,
    ) -> crate::Result<IAPInitializeResponse> {
        self.0
            .run_mobile_plugin("iap_initialize", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn iap_fetch_products(
        &self,
        payload: IAPFetchProductsRequest,
    ) -> crate::Result<IAPFetchProductsResponse> {
        self.0
            .run_mobile_plugin("iap_fetch_products", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn iap_purchase_product(
        &self,
        payload: IAPPurchaseProductRequest,
    ) -> crate::Result<IAPPurchaseProductResponse> {
        self.0
            .run_mobile_plugin("iap_purchase_product", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn iap_restore_purchases(&self) -> crate::Result<IAPRestorePurchasesResponse> {
        self.0
            .run_mobile_plugin("iap_restore_purchases", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_system_color_scheme(&self) -> crate::Result<GetSystemColorSchemeResponse> {
        self.0
            .run_mobile_plugin("get_system_color_scheme", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_safe_area_insets(&self) -> crate::Result<GetSafeAreaInsetsResponse> {
        self.0
            .run_mobile_plugin("get_safe_area_insets", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_screen_brightness(&self) -> crate::Result<GetScreenBrightnessResponse> {
        self.0
            .run_mobile_plugin("get_screen_brightness", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn set_screen_brightness(
        &self,
        payload: SetScreenBrightnessRequest,
    ) -> crate::Result<SetScreenBrightnessResponse> {
        self.0
            .run_mobile_plugin("set_screen_brightness", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn get_external_sdcard_path(&self) -> crate::Result<GetExternalSDCardPathResponse> {
        self.0
            .run_mobile_plugin("get_external_sdcard_path", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn open_external_url(
        &self,
        payload: OpenExternalUrlRequest,
    ) -> crate::Result<OpenExternalUrlResponse> {
        self.0
            .run_mobile_plugin("open_external_url", payload)
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn select_directory(&self) -> crate::Result<SelectDirectoryResponse> {
        self.0
            .run_mobile_plugin("select_directory", ())
            .map_err(Into::into)
    }
}

impl<R: Runtime> NativeBridge<R> {
    pub fn request_manage_storage_permission(
        &self,
    ) -> crate::Result<RequestManageStoragePermissionResponse> {
        self.0
            .run_mobile_plugin("request_manage_storage_permission", ())
            .map_err(Into::into)
    }
}
