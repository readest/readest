# Third-party notices

Readest loads the following assets for local manga OCR and translation.

## Runtime packages

- `@huggingface/transformers` 3.8.1 provides browser model loading and inference. It is licensed under the [Apache License 2.0](LICENSE-APACHE-2.0.txt). The corresponding source is [huggingface/transformers.js at tag `3.8.1`, commit `2ec882e739e4cb461f8d440d4d7394cbf5372429`](https://github.com/huggingface/transformers.js/tree/2ec882e739e4cb461f8d440d4d7394cbf5372429).
- `onnxruntime-web` 1.29.0 provides WebAssembly inference. It is licensed under the [MIT License](LICENSE-MIT-ONNXRUNTIME.txt). Copyright Microsoft Corporation. Its complete upstream [third-party notices](ONNXRUNTIME-ThirdPartyNotices.txt) are included with the runtime assets.
- `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 provide OCR. Both are licensed under the [Apache License 2.0](LICENSE-APACHE-2.0.txt). The setup script also copies each package's license beside its generated runtime files.
- `@tesseract.js-data/<language>` 1.0.0 provides the pinned Tesseract traineddata files. The packages declare the [MIT License](LICENSE-MIT-TESSERACT-DATA.txt), are attributed to Balearica and contributors, and are sourced from [naptha/tessdata](https://github.com/naptha/tessdata).

## Remote models

The model files are fetched at runtime from pinned Hugging Face revisions.

- `ogkalu/comic-text-and-bubble-detector`, `detector-v4-s_int8.onnx`, revision `16e8a622f91fabc6b5b65c96d32d1183f8843546`. Attribution: ogkalu. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Source model](https://huggingface.co/ogkalu/comic-text-and-bubble-detector/tree/16e8a622f91fabc6b5b65c96d32d1183f8843546).
- `mayocream/koharu`, `comictextdetector.onnx`, revision `15439cba09df388c51de6e47c6020bc31edab41f`. Attribution: mayocream and comic-text-detector contributors. License: [GNU Affero General Public License 3.0](https://huggingface.co/mayocream/koharu/blob/15439cba09df388c51de6e47c6020bc31edab41f/LICENSE). [Source model](https://huggingface.co/mayocream/koharu/tree/15439cba09df388c51de6e47c6020bc31edab41f).
- `fumetodev/PP-OCRv6_small_rec_manga_ONNX`, `ppocr-rec-v6-small-manga.onnx`, revision `1ef01f78c59f6f66389c9722fd2d0ab761680ea9`. Attribution: fumetodev and PaddlePaddle contributors. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Source model](https://huggingface.co/fumetodev/PP-OCRv6_small_rec_manga_ONNX/tree/1ef01f78c59f6f66389c9722fd2d0ab761680ea9).
- `PaddlePaddle/PaddleOCR`, `ppocrv6_dict.txt`, revision `e5046169b225bcdfbe25d45b4e809ff0f1a69c2c`. Attribution: PaddlePaddle contributors. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Source dictionary](https://github.com/PaddlePaddle/PaddleOCR/blob/e5046169b225bcdfbe25d45b4e809ff0f1a69c2c/ppocr/utils/dict/ppocrv6_dict.txt).
- `Xenova/opus-mt-ja-en`, quantized ONNX files, revision `1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16`. It is the Transformers.js conversion of `Helsinki-NLP/opus-mt-ja-en`. Attribution: Helsinki-NLP and Xenova. License: [Apache License 2.0](LICENSE-APACHE-2.0.txt). [Converted model](https://huggingface.co/Xenova/opus-mt-ja-en/tree/1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16). [Original model](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en).
