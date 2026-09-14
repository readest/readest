# Third-party notices

Readest loads the following assets for local OCR.

## Runtime packages

- `onnxruntime-web` 1.29.0 provides WebAssembly inference. It is licensed under the [MIT License](LICENSE-MIT-ONNXRUNTIME.txt). Copyright Microsoft Corporation. Its complete upstream [third-party notices](ONNXRUNTIME-ThirdPartyNotices.txt) are included with the runtime assets.
- `paddleocr` 1.2.0 provides the browser recognition pipeline. Its pinned [package metadata](https://github.com/x3zvawq/paddleocr.js/blob/bb22fe768879ae9d779afe99f018f4f860cceaf6/package.json) declares the MIT License.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 provide OCR. Both are licensed under the [Apache License 2.0](LICENSE-APACHE-2.0.txt). The setup script also copies each package's license beside its generated runtime files.
- `@tesseract.js-data/<language>` 1.0.0 provides the pinned Tesseract traineddata files. The packages declare the [MIT License](LICENSE-MIT-TESSERACT-DATA.txt), are attributed to Balearica and contributors, and are sourced from [naptha/tessdata](https://github.com/naptha/tessdata).

## Remote models

The model files are fetched at runtime from pinned Hugging Face revisions.

MangaOCR refinement uses the q8 encoder and decoder from `onnx-community/manga-ocr-base-ONNX`, revision `f9023406bb2f6b17df67bc4a327c56ecd20611f0`, and the vocabulary from `kha-white/manga-ocr-base`, revision `aa6573bd10b0d446cbf622e29c3e084914df9741`. Attribution: kha-white, MangaOCR contributors, and ONNX Community. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). WhiteHades compressed the ONNX files with gzip. The [download mirror](https://huggingface.co/WhiteHades/manga-ocr-browser/tree/3e8ddcd02cd50e897358223fce8b2784e44093ab) retains the original weights, license and attribution. Readest verifies both compressed and decompressed checksums.

- `mayocream/koharu`, `comictextdetector.onnx`, revision `15439cba09df388c51de6e47c6020bc31edab41f`. Attribution: mayocream and comic-text-detector contributors. License: [GNU Affero General Public License 3.0](https://huggingface.co/mayocream/koharu/blob/15439cba09df388c51de6e47c6020bc31edab41f/LICENSE). [Source model](https://huggingface.co/mayocream/koharu/tree/15439cba09df388c51de6e47c6020bc31edab41f).
- `PaddlePaddle/PP-OCRv6_small_rec_onnx`, `inference.onnx`, revision `b8f84f0b80c529de40b4fbb3544b84fa7233a513`, and the PP-OCRv6 dictionary at PaddleOCR revision `2661c7c0ef5c613e8f93c6e93b2e052399f0f854`. Attribution: PaddlePaddle and PaddleOCR contributors. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Source model](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/tree/b8f84f0b80c529de40b4fbb3544b84fa7233a513).
