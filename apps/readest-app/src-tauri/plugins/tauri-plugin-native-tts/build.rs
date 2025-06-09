const COMMANDS: &[&str] = &[
    "init",
    "speak",
    "stop",
    "pause",
    "resume",
    "set_rate",
    "set_pitch",
    "set_voice",
    "set_primary_lang",
    "get_voices",
    "get_voice_id",
    "get_all_voices",
    "get_granularities",
    "get_speaking_lang",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
