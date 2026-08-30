# Third-party notices

Readest loads the following assets for local manga OCR and translation.

## Runtime packages

- `@browsermt/bergamot-translator` 0.4.9 provides the translation worker. It is licensed under the [Mozilla Public License 2.0](LICENSE-MPL-2.0.txt).
- `onnxruntime-web` 1.29.0 provides WebAssembly inference. It is licensed under the [MIT License](LICENSE-MIT-ONNXRUNTIME.txt). Copyright Microsoft Corporation.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 provide OCR. Both are licensed under the [Apache License 2.0](LICENSE-APACHE-2.0.txt). The setup script also copies each package's license beside its generated runtime files.
- `@tesseract.js-data/<language>` 1.0.0 provides the pinned Tesseract traineddata files. The packages declare the [MIT License](LICENSE-MIT-TESSERACT-DATA.txt), are attributed to Balearica and contributors, and are sourced from [naptha/tessdata](https://github.com/naptha/tessdata).

## Remote models

The model files are fetched at runtime from pinned Hugging Face revisions.

- `ogkalu/comic-text-and-bubble-detector`, `detector-v4-s_int8.onnx`, revision `16e8a622f91fabc6b5b65c96d32d1183f8843546`. Attribution: ogkalu. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Source model](https://huggingface.co/ogkalu/comic-text-and-bubble-detector/tree/16e8a622f91fabc6b5b65c96d32d1183f8843546).
- `TiberiuCristianLeon/Bergamot`, `base-memory/jaen`, revision `ffb33a7be7079f5c1a1d8db07f9b5c432f0bcc87`. Attribution: TiberiuCristianLeon. License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). [Source model](https://huggingface.co/TiberiuCristianLeon/Bergamot/tree/ffb33a7be7079f5c1a1d8db07f9b5c432f0bcc87/base-memory/jaen).
