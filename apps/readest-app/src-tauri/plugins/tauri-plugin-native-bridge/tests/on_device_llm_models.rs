use tauri_plugin_native_bridge::{
    OnDeviceLlmCancelRequest, OnDeviceLlmGenerateRequest, OnDeviceLlmGenerateResponse,
    OnDeviceLlmStatusResponse,
};

#[test]
fn on_device_llm_models_keep_every_wire_field() {
    let req: OnDeviceLlmGenerateRequest = serde_json::from_str(
        r#"{"requestId":"r1","instructions":"sys","prompt":"hi","temperature":0.3,"maxTokens":400}"#,
    )
    .unwrap();
    assert_eq!(req.request_id, "r1");
    assert_eq!(req.instructions, "sys");
    assert_eq!(req.prompt, "hi");
    assert_eq!(req.temperature, Some(0.3));
    assert_eq!(req.max_tokens, Some(400));
    let forwarded = serde_json::to_string(&req).unwrap();
    assert!(forwarded.contains("\"requestId\":\"r1\""));
    assert!(forwarded.contains("\"maxTokens\":400"));

    let bare: OnDeviceLlmGenerateRequest =
        serde_json::from_str(r#"{"requestId":"r2","instructions":"","prompt":"p"}"#).unwrap();
    assert_eq!(bare.temperature, None);
    assert_eq!(bare.max_tokens, None);

    let cancel: OnDeviceLlmCancelRequest = serde_json::from_str(r#"{"requestId":"r1"}"#).unwrap();
    assert!(serde_json::to_string(&cancel)
        .unwrap()
        .contains("\"requestId\":\"r1\""));

    let status: OnDeviceLlmStatusResponse =
        serde_json::from_str(r#"{"available":false,"reason":"appleIntelligenceNotEnabled"}"#)
            .unwrap();
    assert_eq!(
        status.reason.as_deref(),
        Some("appleIntelligenceNotEnabled")
    );

    let resp: OnDeviceLlmGenerateResponse = serde_json::from_str(r#"{"text":"Bonjour"}"#).unwrap();
    assert_eq!(resp.text, "Bonjour");
}

#[test]
fn on_device_llm_status_keeps_window_and_languages() {
    let json = r#"{"available":true,"contextSize":4096,"languages":["en","zh"]}"#;
    let status: OnDeviceLlmStatusResponse = serde_json::from_str(json).unwrap();
    let forwarded = serde_json::to_value(&status).unwrap();
    assert_eq!(forwarded["contextSize"], 4096);
    assert_eq!(forwarded["languages"], serde_json::json!(["en", "zh"]));
}
