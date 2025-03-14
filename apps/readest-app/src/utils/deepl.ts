const API_URL = 'https://www2.deepl.com/jsonrpc';
const HEADERS = {
  'Content-Type': 'application/json',
};

export type RequestParams = {
  text: string;
  sourceLang: string;
  targetLang: string;
};

export type RawResponseParams = {
  jsonrpc: string;
  id: number;
  result: {
    texts: {
      alternatives: {
        text: string;
      }[];
      text: string;
    }[];
    lang: string;
    lang_is_confident: boolean;
    detectedLanguages: { unsupported: number } & Record<string, number>;
  };
};

const buildRequestData = (params: RequestParams) => {
  const getTimeStamp = () => {
    const ts = Date.now();
    const iCount = params.text.split('i').length;
    return iCount > 1 ? ts - (ts % iCount) + iCount : ts;
  };

  const postData = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    id: Math.floor(Math.random() * 90000000) + 10000000,
    params: {
      texts: [{ text: params.text, requestAlternatives: 3 }],
      timestamp: getTimeStamp(),
      splitting: 'newlines',
      lang: {
        source_lang_user_selected: params.sourceLang.toUpperCase(),
        target_lang: params.targetLang.toUpperCase(),
      },
    },
  };

  let postStr = JSON.stringify(postData);

  if ((postData.id + 5) % 29 === 0 || (postData.id + 3) % 13 === 0) {
    postStr = postStr.replace('"method":"', '"method" : "');
  } else {
    postStr = postStr.replace('"method":"', '"method": "');
  }

  return postStr;
};

export const query = async (params: RequestParams) => {
  const response = await fetch(API_URL, {
    headers: HEADERS,
    method: 'POST',
    body: buildRequestData(params),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 429 ? 'Too many requests, please try again later.' : 'Unknown error.',
    );
  }

  const { result } = (await response.json()) as RawResponseParams;
  return {
    translations: [
      {
        detected_source_language: result?.lang || params?.sourceLang || 'auto',
        text: result?.texts?.[0]?.text || '',
      },
    ],
  };
};
