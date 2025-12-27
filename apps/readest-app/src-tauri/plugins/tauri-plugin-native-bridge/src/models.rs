use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    pub auth_url: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub redirect_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyURIRequest {
    pub uri: String,
    pub dst: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyURIResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UseBackgroundAudioRequest {
    pub enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageRequest {
    pub path: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSystemUIVisibilityRequest {
    pub visible: bool,
    pub dark_mode: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSystemUIVisibilityResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetStatusBarHeightResponse {
    pub height: u32,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSysFontsListResponse {
    pub fonts: HashMap<String, String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptKeysRequest {
    pub volume_keys: Option<bool>,
    pub back_key: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockScreenOrientationRequest {
    pub orientation: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub title: String,
    pub description: String,
    pub price: String,
    pub price_currency_code: Option<String>,
    pub price_amount_micros: i64,
    pub product_type: String, // "consumable", "non_consumable", or "subscription"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub platform: String, // "ios" or "android"
    pub package_name: Option<String>,
    pub product_id: String,
    pub transaction_id: Option<String>,
    pub original_transaction_id: Option<String>,
    pub order_id: Option<String>,
    pub purchase_token: Option<String>,
    pub purchase_date: String,
    pub purchase_state: String, // "purchased", "pending", "cancelled", "restored"
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPIsAvailableResponse {
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPInitializeRequest {
    pub public_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPInitializeResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPFetchProductsRequest {
    pub product_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPFetchProductsResponse {
    pub products: Vec<Product>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPPurchaseProductRequest {
    pub product_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPPurchaseProductResponse {
    pub purchase: Option<Purchase>,
    pub cancelled_purchase: Option<Purchase>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IAPRestorePurchasesResponse {
    pub purchases: Vec<Purchase>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSystemColorSchemeResponse {
    pub color_scheme: String, // "light" or "dark"
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSafeAreaInsetsResponse {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetScreenBrightnessResponse {
    pub brightness: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScreenBrightnessRequest {
    pub brightness: f64, // 0.0 to 1.0
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScreenBrightnessResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetExternalSDCardPathResponse {
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestManageStoragePermissionResponse {
    pub manage_storage: String, // "granted", "denied", or "prompt"
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlRequest {
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlResponse {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectDirectoryResponse {
    pub cancelled: Option<bool>,
    pub uri: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}
