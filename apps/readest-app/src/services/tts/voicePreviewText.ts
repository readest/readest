import { READEST_VOICE_PREVIEW_MAX_CHARS } from '@/services/constants';
import { estimateSentenceSeconds } from './ttsDuration';

// What a voice preview reads: whole sentences from the page being read, else a
// short sample in the voice's language. Samples speak about "this voice" and
// to the listener in the plural or polite form, so no language needs a
// gendered verb for the voice speaking them.

const SAMPLES: Record<string, string> = {
  af: 'Hallo! So klink hierdie stem. Ontspan en geniet jou boek.',
  am: 'ሰላም! ይህ ድምፅ እንዲህ ይሰማል። ዘና ብለው መጽሐፍዎን ይደሰቱ።',
  ar: 'مرحبًا! هكذا يبدو هذا الصوت. استرخوا واستمتعوا بكتابكم.',
  az: 'Salam! Bu səs belə eşidilir. Rahatlayın və kitabınızdan zövq alın.',
  bg: 'Здравейте! Ето как звучи този глас. Отпуснете се и се насладете на книгата.',
  bn: 'নমস্কার! এই কণ্ঠস্বরটি এমন শোনায়। আরাম করে বসুন এবং আপনার বইটি উপভোগ করুন।',
  bs: 'Zdravo! Ovako zvuči ovaj glas. Opustite se i uživajte u knjizi.',
  ca: 'Hola! Així sona aquesta veu. Relaxeu-vos i gaudiu del llibre.',
  cs: 'Dobrý den! Takhle zní tento hlas. Pohodlně se usaďte a užijte si knihu.',
  cy: "Helo! Dyma sut mae'r llais hwn yn swnio. Ymlaciwch a mwynhewch eich llyfr.",
  da: 'Hej! Sådan lyder denne stemme. Læn dig tilbage, slap af og nyd din bog.',
  de: 'Hallo! So klingt diese Stimme. Lehnen Sie sich zurück und genießen Sie Ihr Buch.',
  el: 'Γεια σας! Έτσι ακούγεται αυτή η φωνή. Χαλαρώστε και απολαύστε το βιβλίο σας.',
  en: 'Hello! This is how this voice sounds. Sit back, relax, and enjoy your book.',
  es: '¡Hola! Así suena esta voz. Relájese y disfrute de su libro.',
  et: 'Tere! Nii kõlab see hääl. Lõdvestuge ja nautige oma raamatut.',
  fa: 'سلام! این صدا این‌گونه شنیده می‌شود. راحت بنشینید و از کتابتان لذت ببرید.',
  fi: 'Hei! Tältä tämä ääni kuulostaa. Rentoudu ja nauti kirjastasi.',
  fil: 'Kumusta! Ganito ang tunog ng boses na ito. Magpahinga at tamasahin ang inyong libro.',
  fr: 'Bonjour ! Voici comment sonne cette voix. Installez-vous et profitez de votre livre.',
  ga: 'Dia daoibh! Seo mar a fhuaimníonn an guth seo. Ligigí bhur scíth agus bainigí taitneamh as an leabhar.',
  gl: 'Ola! Así soa esta voz. Relaxe e goce do seu libro.',
  gu: 'નમસ્તે! આ અવાજ આવો સંભળાય છે. આરામથી બેસો અને તમારા પુસ્તકનો આનંદ માણો.',
  he: 'שלום! כך נשמע הקול הזה. תירגעו ותיהנו מהספר.',
  hi: 'नमस्ते! यह आवाज़ ऐसी सुनाई देती है। आराम से बैठिए और अपनी किताब का आनंद लीजिए।',
  hr: 'Pozdrav! Ovako zvuči ovaj glas. Opustite se i uživajte u knjizi.',
  hu: 'Jó napot! Így szól ez a hang. Dőljön hátra, és élvezze a könyvet.',
  id: 'Halo! Beginilah suara ini terdengar. Bersantailah dan nikmati buku Anda.',
  is: 'Halló! Svona hljómar þessi rödd. Slakið á og njótið bókarinnar.',
  it: 'Ciao! Ecco come suona questa voce. Rilassatevi e godetevi il vostro libro.',
  ja: 'こんにちは！これがこの声の響きです。ゆったりとくつろいで、読書をお楽しみください。',
  jv: 'Halo! Kaya mangkene swarane iki. Santai wae lan nikmati bukune.',
  ka: 'გამარჯობა! ასე ჟღერს ეს ხმა. დაისვენეთ და ისიამოვნეთ თქვენი წიგნით.',
  kk: 'Сәлеметсіз бе! Бұл дауыс осылай естіледі. Демалып, кітабыңыздан ләззат алыңыз.',
  km: 'សួស្តី! សំឡេងនេះស្តាប់ទៅដូច្នេះ។ សូមសម្រាក ហើយរីករាយជាមួយសៀវភៅរបស់អ្នក។',
  kn: 'ನಮಸ್ಕಾರ! ಈ ಧ್ವನಿ ಹೀಗೆ ಕೇಳಿಸುತ್ತದೆ. ಆರಾಮವಾಗಿ ಕುಳಿತು ನಿಮ್ಮ ಪುಸ್ತಕವನ್ನು ಆನಂದಿಸಿ.',
  ko: '안녕하세요! 이 목소리는 이렇게 들립니다. 편안히 앉아 책을 즐겨 보세요.',
  lo: 'ສະບາຍດີ! ສຽງນີ້ຟັງແບບນີ້. ພັກຜ່ອນ ແລະ ເພີດເພີນກັບປຶ້ມຂອງທ່ານ.',
  lt: 'Sveiki! Štai kaip skamba šis balsas. Atsipalaiduokite ir mėgaukitės knyga.',
  lv: 'Sveiki! Lūk, kā skan šī balss. Atpūtieties un baudiet savu grāmatu.',
  mk: 'Здраво! Вака звучи овој глас. Опуштете се и уживајте во книгата.',
  ml: 'നമസ്കാരം! ഈ ശബ്ദം ഇങ്ങനെയാണ് കേൾക്കുന്നത്. സുഖമായി ഇരുന്ന് നിങ്ങളുടെ പുസ്തകം ആസ്വദിക്കൂ.',
  mn: 'Сайн байна уу! Энэ дуу хоолой ингэж сонсогддог. Тайвширч, номоо таашаалтай уншаарай.',
  mr: 'नमस्कार! हा आवाज असा ऐकू येतो. आरामात बसा आणि तुमच्या पुस्तकाचा आनंद घ्या.',
  ms: 'Helo! Beginilah bunyi suara ini. Bersantailah dan nikmati buku anda.',
  mt: "Bongu! Hekk jinstema' dan il-leħen. Irrilassaw u gawdu l-ktieb tagħkom.",
  my: 'မင်္ဂလာပါ! ဒီအသံက ဒီလိုကြားရပါတယ်။ အေးအေးဆေးဆေး ထိုင်ပြီး စာအုပ်ကို ခံစားပါ။',
  nb: 'Hei! Slik høres denne stemmen ut. Len deg tilbake, slapp av og nyt boken din.',
  ne: 'नमस्ते! यो आवाज यस्तो सुनिन्छ। आरामसँग बस्नुहोस् र आफ्नो किताबको आनन्द लिनुहोस्।',
  nl: 'Hallo! Zo klinkt deze stem. Leun achterover, ontspan en geniet van je boek.',
  pl: 'Dzień dobry! Tak brzmi ten głos. Proszę usiąść wygodnie i cieszyć się lekturą.',
  ps: 'سلام! دا غږ داسې اورېدل کېږي. آرام کېنئ او له خپل کتاب څخه خوند واخلئ.',
  pt: 'Olá! É assim que esta voz soa. Relaxe e aproveite o seu livro.',
  ro: 'Bună ziua! Așa sună această voce. Relaxați-vă și bucurați-vă de carte.',
  ru: 'Здравствуйте! Вот как звучит этот голос. Устраивайтесь поудобнее и наслаждайтесь книгой.',
  si: 'ආයුබෝවන්! මෙම හඬ ඇසෙන්නේ මෙලෙසයි. සැහැල්ලුවෙන් ඉඳගෙන ඔබේ පොත රස විඳින්න.',
  sk: 'Dobrý deň! Takto znie tento hlas. Pohodlne sa usaďte a užite si knihu.',
  sl: 'Pozdravljeni! Tako zveni ta glas. Udobno se namestite in uživajte v knjigi.',
  so: 'Salaan! Codkani sidan ayuu u dhawaaqaa. Naso oo ku raaxayso buuggaaga.',
  sq: 'Përshëndetje! Kështu tingëllon ky zë. Çlodhuni dhe shijoni librin tuaj.',
  sr: 'Здраво! Овако звучи овај глас. Опустите се и уживајте у књизи.',
  su: 'Halo! Kieu sorana sora ieu. Santai sarta nikmati bukuna.',
  sv: 'Hej! Så här låter den här rösten. Luta dig tillbaka, slappna av och njut av din bok.',
  sw: 'Habari! Hivi ndivyo sauti hii inavyosikika. Tulia na ufurahie kitabu chako.',
  ta: 'வணக்கம்! இந்தக் குரல் இப்படித்தான் ஒலிக்கும். நிதானமாக அமர்ந்து உங்கள் புத்தகத்தை ரசியுங்கள்.',
  te: 'నమస్కారం! ఈ స్వరం ఇలా వినిపిస్తుంది. హాయిగా కూర్చుని మీ పుస్తకాన్ని ఆస్వాదించండి.',
  th: 'สวัสดี! เสียงนี้ฟังเป็นแบบนี้ ผ่อนคลายและเพลิดเพลินกับหนังสือของคุณ',
  tr: 'Merhaba! Bu ses böyle duyuluyor. Arkanıza yaslanın ve kitabınızın tadını çıkarın.',
  uk: 'Вітаю! Ось як звучить цей голос. Влаштовуйтеся зручніше й насолоджуйтеся книжкою.',
  ur: 'السلام علیکم! یہ آواز ایسی سنائی دیتی ہے۔ آرام سے بیٹھیں اور اپنی کتاب سے لطف اٹھائیں۔',
  uz: 'Salom! Bu ovoz shunday eshitiladi. Dam oling va kitobingizdan zavqlaning.',
  vi: 'Xin chào! Giọng đọc này nghe như thế này. Hãy thư giãn và tận hưởng cuốn sách của bạn.',
  zh: '你好！这就是这个声音的效果。放松下来，好好享受你的书吧。',
  'zh-Hant': '你好！這就是這個聲音的效果。放輕鬆，好好享受你的書吧。',
  zu: 'Sawubona! Leli zwi lizwakala kanje. Phumula futhi ujabulele incwadi yakho.',
};

// Taiwan, Hong Kong and Macau read Traditional characters.
const TRADITIONAL_CHINESE = /^zh-(Hant|TW|HK|MO)\b/i;

// A sample in the language, else in English (a language without one here).
export const getSampleText = (lang: string): string => {
  if (TRADITIONAL_CHINESE.test(lang)) return SAMPLES['zh-Hant']!;
  const primary = lang.toLowerCase().split('-')[0]!;
  return SAMPLES[primary === 'no' ? 'nb' : primary] ?? SAMPLES['en']!;
};

// At least this much speech, so the voice can be judged on more than a phrase.
export const PREVIEW_MIN_SECONDS = 5;

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, pre, td, th, div';
// Enough text to find the sentences in; a chapter can be megabytes.
const SCAN_CHARS = READEST_VOICE_PREVIEW_MAX_CHARS * 4;

const splitSentences = (text: string, lang: string): string[] => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
    return [...segmenter.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
  }
  return (text.match(/[^.!?。！？\n]+[.!?。！？]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
};

const closestBlock = (node: Node): Element | null => {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(BLOCK_SELECTOR) ?? element;
};

// The text from the start of the paragraph the page opens with, a line break
// between paragraphs so a heading never runs into the sentence after it.
const textFromBlock = (block: Element): string => {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  walker.currentNode = block;
  let text = '';
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode(); node && text.length < SCAN_CHARS; node = walker.nextNode()) {
    const content = node.textContent ?? '';
    if (!content.trim()) continue;
    const nodeBlock = closestBlock(node);
    if (lastBlock && nodeBlock !== lastBlock) text += '\n';
    lastBlock = nodeBlock;
    text += content.replace(/\s+/g, ' ');
  }
  return text;
};

// Whole sentences from the start of the page's first paragraph, adding the
// next ones until they make PREVIEW_MIN_SECONDS of estimated speech, within
// the preview length limit. Null when the page has no text.
export const getPagePreviewText = (
  range: Range | null | undefined,
  lang: string,
): string | null => {
  const start = range?.startContainer;
  const block = start && closestBlock(start);
  if (!block) return null;
  let text = '';
  let seconds = 0;
  for (const sentence of splitSentences(textFromBlock(block), lang)) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > READEST_VOICE_PREVIEW_MAX_CHARS) {
      if (text) break;
      // One sentence longer than a preview: cut it at a word boundary.
      const cut = sentence.slice(0, READEST_VOICE_PREVIEW_MAX_CHARS);
      const space = cut.lastIndexOf(' ');
      return space > 0 ? cut.slice(0, space) : cut;
    }
    text = next;
    seconds += estimateSentenceSeconds(sentence, lang, '');
    if (seconds >= PREVIEW_MIN_SECONDS) break;
  }
  return text || null;
};
