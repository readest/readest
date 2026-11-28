import type { ModelAsset } from './modelAssets';

const TESSERACT_DATA_VERSION = '1.0.0';
const TESSERACT_MODEL_REVISION = '4.0.0_best_int';
const TESSERACT_DATA_BASE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

/** The SHA-256 and size of each language's unpacked data. */
const LANGUAGES: Readonly<Record<string, readonly [sha256: string, bytes: number]>> = {
  eng: ['5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747', 5_199_098],
  fra: ['bf83833fa957ff0076f6aa93f69e3bdf7b014dea829ea0c0d6be6b48a3ceef6d', 1_248_107],
  deu: ['a1b72cc25753eac167edfef5af4448a8dc34973503a2265c34c84520f896eb03', 2_070_514],
  nld: ['363c360db9838838ff7ed3d8b885b33acc0d61d37165708303cf8a81e50164f3', 6_065_224],
  ita: ['36ec897f5f1f489b257801881286167a79b99a16040c6fbc7e3e30f03821b10b', 3_126_172],
  jpn: ['1a0175291ea145d4a66be681d1084496f10af938aacab247c5d40b31359a604e', 3_039_374],
  jpn_vert: ['fd18c080bdea33b048d7fe933ad5c439081aae9143fcb2abcc0c0ab98697226f', 3_040_074],
  kor: ['ec1749377d49ac38fb3d3cd05dd5e2a53359d329f359762bc638a81132109992', 2_208_378],
  kor_vert: ['ecdf05edae79db5861324a65d6380a11f007544c581961c01aebdab83b2507a8', 1_128_659],
  spa: ['0062377729b81cc268b1822f09eb1c08c09f3f7f1c6b422540b51555a7eeea70', 3_379_457],
  por: ['42fab1f017aedab69b92bdecc01bbb11166cd3b177575612ee860f8e2825ece0', 2_422_444],
  rus: ['eb9be824435f6bb0f993925acb85fd842c8418d6db7613c818e749e619a1ad6d', 5_053_706],
  heb: ['a95d74d445e9bbb772a3572b4f01741309b3ab2c015773ef6fe7f25829c2dd0b', 1_074_644],
  ara: ['e7d6494e2ef249ee97ad151eb01e0e6ae3aaf429256442ad6af534862a2a8c0f', 2_495_395],
  fas: ['ff6a6743a643ebd93717346ae6526aed110aad4e08ca10240279787fc567522c', 561_300],
  ell: ['c8dc383cf201efee45b3f83bf3f8d005bf544ace6a937c46813de5196ea5d79f', 2_121_037],
  ukr: ['c9bceda0ec7f1cd8dc7642ec62221395066b98359fa0e988d5db82ceae727892', 4_365_622],
  pol: ['02b89cad819f1374631b4a3c92bdac79c214150f97a3686df78de6c8c30782db', 5_426_310],
  slv: ['b432c0be7d58465be202c43cd73978ae5af5de0d95c81c42b32cc5c29d4b9b25', 3_118_549],
  tur: ['f0127d0f3745f9c65e2ae7ec6b23198fbe5aa186a61b35661426f5e1ef9dedd7', 4_680_866],
  hin: ['187d00e09ac523b0e7c8c3edf93050ffc1caa8083674fd637f6a493178c5caff', 1_651_097],
  ind: ['431ad6931126cfd70a35db57eb14823c090fc6174e0eaf1f400dd06b9cb1baf3', 1_776_253],
  vie: ['112f6fd1d04ab4cb0208cad9cada8de214ae33a1e4db3750ffcda69262aef0a8', 1_667_949],
  tha: ['e8cf7af22c02b1cbd1b3a29a76c8e8bacc22c67dac28d8c95a2b40f36c359a70', 1_072_730],
  msa: ['e82c6e95deb6acddf647e8ac433eedc8cdd38e160f5822e6a42acf3f7c935a7b', 1_747_809],
  bod: ['0b1765dcbfef1ece5f3f425ad1eb9826024a72d71db24ca8e3e2a76a011f906f', 1_966_440],
  ben: ['0b3319da916ce374b1863955d1d61e2aebdebe37bf4e0dbfa59c8596f6d2e57f', 1_789_844],
  tam: ['84bd618771f88ac6611f257949b4807a1527563a499d79e38b921674465ae22e', 3_353_494],
  sin: ['6b49f3ca8cc83f94d236c9483bc02d2d109a5d8d7db376f3bed513e79e69bdf0', 1_727_461],
  chi_sim: ['9784f7c917c546424b690fcde708ce1f604a4393d08bb51ddab146d7d7c794e6', 2_471_033],
  chi_sim_vert: ['76f2e4a08988008b0d0013202c376790dedebd36f8e83cba46b66461e6d4803b', 2_471_117],
  chi_tra: ['6abfb87cce5db0d09624f16eedd8a0b24173718856121f721b6d1214193d4dab', 2_368_636],
  chi_tra_vert: ['5b279338e657610357b4fb32424ee6373e6b406e763241b8221239fc58938861', 2_368_422],
  ron: ['d25de8fa98f58eb80365a5c53482a591caf02afd0719a57dcd5eaa081d48486b', 3_051_219],
  hun: ['f46ebe2687bc1f283a64e6e6ce5fd9a80db987dd5227257b2194bafc97c02f41', 5_838_145],
  uzb: ['673f17b258b1532249b1d4f294dafeb6c80c4a25da41d0e8d8e9fdcdc0a52a7e', 6_470_711],
  kat: ['e431463c52ed976b33ef10fc60b0a03443866e896f9b547c1e156bf1acdbd0a1', 2_524_777],
};

export const getTesseractLanguageAsset = (code: string): ModelAsset => {
  const language = LANGUAGES[code];
  if (!language) throw new Error(`No verified Tesseract language asset is configured for ${code}`);
  const [sha256, bytes] = language;
  return {
    url: `${TESSERACT_DATA_BASE_URL}/${code}@${TESSERACT_DATA_VERSION}/${TESSERACT_MODEL_REVISION}/${code}.traineddata.gz`,
    sha256,
    bytes,
    gzip: true,
  };
};
