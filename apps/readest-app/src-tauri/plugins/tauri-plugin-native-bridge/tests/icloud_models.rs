use tauri_plugin_native_bridge::{
    ICloudContainerStatusResponse, ICloudEnsureDownloadedRequest, ICloudEnsureDownloadedResponse,
};

#[test]
fn icloud_models_use_camel_case_wire_names() {
    let req: ICloudEnsureDownloadedRequest =
        serde_json::from_str(r#"{"path":"/a/b.json","timeoutMs":5000}"#).unwrap();
    assert_eq!(req.path, "/a/b.json");
    assert_eq!(req.timeout_ms, Some(5000));

    let req_no_timeout: ICloudEnsureDownloadedRequest =
        serde_json::from_str(r#"{"path":"/a/b.json"}"#).unwrap();
    assert_eq!(req_no_timeout.timeout_ms, None);

    let status = ICloudContainerStatusResponse {
        available: true,
        documents_path: Some("/d/Documents".into()),
    };
    assert!(serde_json::to_string(&status)
        .unwrap()
        .contains("\"documentsPath\""));

    let resp = ICloudEnsureDownloadedResponse {
        status: "notFound".into(),
    };
    assert!(serde_json::to_string(&resp)
        .unwrap()
        .contains("\"notFound\""));
}
