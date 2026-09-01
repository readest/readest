# Third-party notices

Readest loads the following assets for local OCR.

## Runtime packages

- `onnxruntime-web` 1.29.0 provides WebAssembly inference. It is licensed under the [MIT License](LICENSE-MIT-ONNXRUNTIME.txt). Copyright Microsoft Corporation. Its complete upstream [third-party notices](ONNXRUNTIME-ThirdPartyNotices.txt) are included with the runtime assets.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 provide OCR. Both are licensed under the [Apache License 2.0](LICENSE-APACHE-2.0.txt). The setup script also copies each package's license beside its generated runtime files.
- `@tesseract.js-data/<language>` 1.0.0 provides the pinned Tesseract traineddata files. The packages declare the [MIT License](LICENSE-MIT-TESSERACT-DATA.txt), are attributed to Balearica and contributors, and are sourced from [naptha/tessdata](https://github.com/naptha/tessdata).

## Remote models

The model files are fetched at runtime from pinned Hugging Face revisions.

- `mayocream/koharu`, `comictextdetector.onnx`, revision `15439cba09df388c51de6e47c6020bc31edab41f`. Attribution: mayocream and comic-text-detector contributors. License: [GNU Affero General Public License 3.0](https://huggingface.co/mayocream/koharu/blob/15439cba09df388c51de6e47c6020bc31edab41f/LICENSE). [Source model](https://huggingface.co/mayocream/koharu/tree/15439cba09df388c51de6e47c6020bc31edab41f).
