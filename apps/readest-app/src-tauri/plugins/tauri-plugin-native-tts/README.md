# Tauri Plugin native-tts

Run the device-free Linux lifecycle regressions from this directory:

```sh
python3 -I tests/linux_lifecycle.py
```

The fixture compiles the production command handler and worker with deterministic
executor and audio-device stubs using `rustc --test`. It checks transport command
ordering and replacement of device streams after seeking or changing playback rate.
