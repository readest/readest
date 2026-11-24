const TESSERACT_DATA_VERSION = '1.0.0';
const TESSERACT_MODEL_REVISION = '4.0.0_best_int';
const TESSERACT_DATA_BASE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

export interface TesseractLanguageAsset {
  code: string;
  url: string;
  sha256: string;
  compressedSha256: string;
  compression: 'gzip';
  maximumDownloadBytes: number;
  maximumResultBytes: number;
}

interface TesseractLanguageAssetSpec {
  code: string;
  compressedSha256: string;
  compressedBytes: number;
  sha256: string;
  resultBytes: number;
}

const ASSET_SPECS: readonly TesseractLanguageAssetSpec[] = [
  {
    code: 'eng',
    compressedSha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
    compressedBytes: 2_952_873,
    sha256: '5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747',
    resultBytes: 5_199_098,
  },
  {
    code: 'fra',
    compressedSha256: 'd611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255',
    compressedBytes: 707_406,
    sha256: 'bf83833fa957ff0076f6aa93f69e3bdf7b014dea829ea0c0d6be6b48a3ceef6d',
    resultBytes: 1_248_107,
  },
  {
    code: 'deu',
    compressedSha256: '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b',
    compressedBytes: 1_333_102,
    sha256: 'a1b72cc25753eac167edfef5af4448a8dc34973503a2265c34c84520f896eb03',
    resultBytes: 2_070_514,
  },
  {
    code: 'nld',
    compressedSha256: 'a2d904b6ddc4feb0d31ecfcd7361a554102e7aa2e278c54f4fc029e0d0815571',
    compressedBytes: 3_005_696,
    sha256: '363c360db9838838ff7ed3d8b885b33acc0d61d37165708303cf8a81e50164f3',
    resultBytes: 6_065_224,
  },
  {
    code: 'ita',
    compressedSha256: 'f702fcfad297ce028ede3626d1467b67939f23ff23595f9badd54681cf25a4d3',
    compressedBytes: 1_660_998,
    sha256: '36ec897f5f1f489b257801881286167a79b99a16040c6fbc7e3e30f03821b10b',
    resultBytes: 3_126_172,
  },
  {
    code: 'jpn',
    compressedSha256: '2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88',
    compressedBytes: 2_030_256,
    sha256: '1a0175291ea145d4a66be681d1084496f10af938aacab247c5d40b31359a604e',
    resultBytes: 3_039_374,
  },
  {
    code: 'jpn_vert',
    compressedSha256: '3a4f4df8df8f50f3389fe0da10502effced38faef763d8e540142bdc9b770308',
    compressedBytes: 2_022_755,
    sha256: 'fd18c080bdea33b048d7fe933ad5c439081aae9143fcb2abcc0c0ab98697226f',
    resultBytes: 3_040_074,
  },
  {
    code: 'kor',
    compressedSha256: '78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126',
    compressedBytes: 1_572_336,
    sha256: 'ec1749377d49ac38fb3d3cd05dd5e2a53359d329f359762bc638a81132109992',
    resultBytes: 2_208_378,
  },
  {
    code: 'kor_vert',
    compressedSha256: 'e299cca7827988dad481beb5cd4601d02b4fff13efa03312b80224f372c232cf',
    compressedBytes: 620_875,
    sha256: 'ecdf05edae79db5861324a65d6380a11f007544c581961c01aebdab83b2507a8',
    resultBytes: 1_128_659,
  },
  {
    code: 'spa',
    compressedSha256: '40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb',
    compressedBytes: 2_100_190,
    sha256: '0062377729b81cc268b1822f09eb1c08c09f3f7f1c6b422540b51555a7eeea70',
    resultBytes: 3_379_457,
  },
  {
    code: 'por',
    compressedSha256: 'dacebc1386ddaaf8389f81094236cca0d690897cde693d48cbdaa881c86e2b4c',
    compressedBytes: 1_392_239,
    sha256: '42fab1f017aedab69b92bdecc01bbb11166cd3b177575612ee860f8e2825ece0',
    resultBytes: 2_422_444,
  },
  {
    code: 'rus',
    compressedSha256: 'f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a',
    compressedBytes: 2_679_598,
    sha256: 'eb9be824435f6bb0f993925acb85fd842c8418d6db7613c818e749e619a1ad6d',
    resultBytes: 5_053_706,
  },
  {
    code: 'heb',
    compressedSha256: '9c70b524200dae77fb25e3567566eee600ccbcae9aeb89722990ccae0e84e805',
    compressedBytes: 580_576,
    sha256: 'a95d74d445e9bbb772a3572b4f01741309b3ab2c015773ef6fe7f25829c2dd0b',
    resultBytes: 1_074_644,
  },
  {
    code: 'ara',
    compressedSha256: 'f4746c44b02342dd5b3d4f0198000f47d7c49f1a229e63e0f436c0592dcd9639',
    compressedBytes: 1_661_906,
    sha256: 'e7d6494e2ef249ee97ad151eb01e0e6ae3aaf429256442ad6af534862a2a8c0f',
    resultBytes: 2_495_395,
  },
  {
    code: 'fas',
    compressedSha256: 'b5847360e25f646c55449f1fe93eee57d53e406a265ead2374e7320bf0b82025',
    compressedBytes: 424_507,
    sha256: 'ff6a6743a643ebd93717346ae6526aed110aad4e08ca10240279787fc567522c',
    resultBytes: 561_300,
  },
  {
    code: 'ell',
    compressedSha256: 'e8a293abb398ec479176c1575aef24e2bacb0611c713f3fa996f97f0cd996fb3',
    compressedBytes: 1_324_749,
    sha256: 'c8dc383cf201efee45b3f83bf3f8d005bf544ace6a937c46813de5196ea5d79f',
    resultBytes: 2_121_037,
  },
  {
    code: 'ukr',
    compressedSha256: 'ea2789a0ad99ff84bfd252a7410a1e8661a7bc5acaa41573d23b54b71446aa4c',
    compressedBytes: 2_114_206,
    sha256: 'c9bceda0ec7f1cd8dc7642ec62221395066b98359fa0e988d5db82ceae727892',
    resultBytes: 4_365_622,
  },
  {
    code: 'pol',
    compressedSha256: 'a20fdec4ff99d8f8e84c708da3e42a4e935c26863055a0ed88aef5c66a59b91b',
    compressedBytes: 2_642_356,
    sha256: '02b89cad819f1374631b4a3c92bdac79c214150f97a3686df78de6c8c30782db',
    resultBytes: 5_426_310,
  },
  {
    code: 'slv',
    compressedSha256: '23550808c5ae045a2c6cabcb8a03a52239ffeaf45571d1120135ddc632d021f1',
    compressedBytes: 1_346_857,
    sha256: 'b432c0be7d58465be202c43cd73978ae5af5de0d95c81c42b32cc5c29d4b9b25',
    resultBytes: 3_118_549,
  },
  {
    code: 'tur',
    compressedSha256: '384ba0dc28040451b7818d7d60e0a88df0d3003fa5a01d713a468779bc3d8c04',
    compressedBytes: 2_141_291,
    sha256: 'f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7',
    resultBytes: 4_680_866,
  },
  {
    code: 'hin',
    compressedSha256: 'f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07',
    compressedBytes: 1_389_692,
    sha256: '187d00e09ac523b0e7c8c3edf93050ffc1caa8083674fd637f6a493178c5caff',
    resultBytes: 1_651_097,
  },
  {
    code: 'ind',
    compressedSha256: 'a8896d2f584a5baae73d658b86b765acc7b15b7ba05e014f62b1a2a23b699a91',
    compressedBytes: 1_194_182,
    sha256: '431ad6931126cfd70a35db57eb14823c090fc6174e0eaf1f400dd06b9cb1baf3',
    resultBytes: 1_776_253,
  },
  {
    code: 'vie',
    compressedSha256: '2284f610f262a1b19ec8df9f196b9ff6ce38ddb4a66329e998941df4b8961c8d',
    compressedBytes: 1_423_003,
    sha256: '112f6fd1d04ab4cb0208cad9cada8de214ae33a1e4db3750ffcda69262aef0a8',
    resultBytes: 1_667_949,
  },
  {
    code: 'tha',
    compressedSha256: '4550a5505184d1b79cf10416d5b19e643001d95411d5e717954dd26feef3ae74',
    compressedBytes: 896_631,
    sha256: 'e8cf7af22c02b1cbd1b3a29a76c8e8bacc22c67dac28d8c95a2b40f36c359a70',
    resultBytes: 1_072_730,
  },
  {
    code: 'msa',
    compressedSha256: '35ae490b99462d04cf4e2a7985d98f0ba5e10ca62adb13aeda070c6f1783f097',
    compressedBytes: 1_177_136,
    sha256: 'e82c6e95deb6acddf647e8ac433eedc8cdd38e160f5822e6a42acf3f7c935a7b',
    resultBytes: 1_747_809,
  },
  {
    code: 'bod',
    compressedSha256: 'e43a8e96ff77d90c25bf401b5282bde758d9d1475d7017c8c6f7bfa4039adb1c',
    compressedBytes: 1_269_959,
    sha256: '0b1765dcbfef1ece5f3f425ad1eb9826024a72d71db24ca8e3e2a76a011f906f',
    resultBytes: 1_966_440,
  },
  {
    code: 'ben',
    compressedSha256: 'a7c1fd170b796d6b8d01b401d4bfcc54409f47b313a200e9e3756ce20d742725',
    compressedBytes: 1_373_429,
    sha256: '0b3319da916ce374b1863955d1d61e2aebdebe37bf4e0dbfa59c8596f6d2e57f',
    resultBytes: 1_789_844,
  },
  {
    code: 'tam',
    compressedSha256: '2c4b255ede87931cb56c20a5b2b8e2cda4913e34fb3e4957f9b9e04ea069ff21',
    compressedBytes: 1_446_167,
    sha256: '84bd618771f88ac6611f257949b4807a1527563a499d79e38b921674465ae22e',
    resultBytes: 3_353_494,
  },
  {
    code: 'sin',
    compressedSha256: '02d34b1f6565d26991fa25605c0bbddd3e39d9eefe471fce4b8a27fe9363ec94',
    compressedBytes: 1_138_317,
    sha256: '6b49f3ca8cc83f94d236c9483bc02d2d109a5d8d7db376f3bed513e79e69bdf0',
    resultBytes: 1_727_461,
  },
  {
    code: 'chi_sim',
    compressedSha256: 'b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c',
    compressedBytes: 1_718_768,
    sha256: '9784f7c917c546424b690fcde708ce1f604a4393d08bb51ddab146d7d7c794e6',
    resultBytes: 2_471_033,
  },
  {
    code: 'chi_sim_vert',
    compressedSha256: '35b2f01aae6642adef8270e50f54583ccef9efcdf21a74525b6f0594bfe84e24',
    compressedBytes: 1_706_654,
    sha256: '76f2e4a08988008b0d0013202c376790dedebd36f8e83cba46b66461e6d4803b',
    resultBytes: 2_471_117,
  },
  {
    code: 'chi_tra',
    compressedSha256: '11fe2610dab05d8a880d02f193ce70203f4c4bbe061b987d5529a2c038a22743',
    compressedBytes: 1_656_239,
    sha256: '6abfb87cce5db0d09624f16eedd8a0b24173718856121f721b6d1214193d4dab',
    resultBytes: 2_368_636,
  },
  {
    code: 'chi_tra_vert',
    compressedSha256: '19044982fdcfdc489a1ad30fca1b0a73d5acf782c9a0146e72d76fdbe7ad3442',
    compressedBytes: 1_645_318,
    sha256: '5b279338e657610357b4fb32424ee6373e6b406e763241b8221239fc58938861',
    resultBytes: 2_368_422,
  },
  {
    code: 'ron',
    compressedSha256: '3c2f550b6369f43254adf637cfe1088c7b6faff3d0382555219315112a24582a',
    compressedBytes: 1_692_160,
    sha256: 'd25de8fa98f58eb80365a5c53482a591caf02afd0719a57dcd5eaa081d48486b',
    resultBytes: 3_051_219,
  },
  {
    code: 'hun',
    compressedSha256: '99feb1ac618ddd39942d646f1df792e5bd4504df45e1ef68e47df51db476a2ed',
    compressedBytes: 2_854_466,
    sha256: 'f46ebe2687bc1f283a64e6e6ce5fd9a80db987dd5227257b2194bafc97c02f41',
    resultBytes: 5_838_145,
  },
  {
    code: 'uzb',
    compressedSha256: '16d7f4a0af8722227ea447c99a2159f1a186af137c392ff8caeb69f2d4ceee20',
    compressedBytes: 3_116_151,
    sha256: '673f17b258b1532249b1d4f294dafeb6c80c4a25da41d0e8d8e9fdcdc0a52a7e',
    resultBytes: 6_470_711,
  },
  {
    code: 'kat',
    compressedSha256: '74505e238b208fc30471654b9f694bda08e521cdc7c8a5e0846d1340ed585899',
    compressedBytes: 1_088_063,
    sha256: 'e431463c52ed976b33ef10fc60b0a03443866e896f9b547c1e156bf1acdbd0a1',
    resultBytes: 2_524_777,
  },
];

export const TESSERACT_LANGUAGE_ASSETS: readonly TesseractLanguageAsset[] = ASSET_SPECS.map(
  (spec) => ({
    code: spec.code,
    url: `${TESSERACT_DATA_BASE_URL}/${spec.code}@${TESSERACT_DATA_VERSION}/${TESSERACT_MODEL_REVISION}/${spec.code}.traineddata.gz`,
    sha256: spec.sha256,
    compressedSha256: spec.compressedSha256,
    compression: 'gzip',
    maximumDownloadBytes: spec.compressedBytes,
    maximumResultBytes: spec.resultBytes,
  }),
);

const ASSETS_BY_CODE = new Map(
  TESSERACT_LANGUAGE_ASSETS.map((asset) => [asset.code, asset] as const),
);

export const getTesseractLanguageAsset = (code: string): TesseractLanguageAsset => {
  const asset = ASSETS_BY_CODE.get(code);
  if (!asset) throw new Error(`No verified Tesseract language asset is configured for ${code}`);
  return asset;
};
