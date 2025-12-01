import init, { simplecc } from '@simplecc/simplecc_wasm';
import { ConvertChineseVariant } from '@/types/book';

let initialized = false;

const initSimpleCC = async () => {
  if (initialized) return;

  await init('/vendor/simplecc/simplecc_wasm_bg.wasm');
  initialized = true;
};

const convertReverseMap: Record<ConvertChineseVariant, ConvertChineseVariant> = {
  none: 'none',
  s2t: 't2s',
  t2s: 's2t',
  s2tw: 'tw2s',
  s2hk: 'hk2s',
  s2twp: 'tw2sp',
  tw2s: 's2tw',
  hk2s: 's2hk',
  tw2sp: 's2twp',
};

const runSimpleCC = (text: string, variant: ConvertChineseVariant, reverse = false): string => {
  return reverse ? simplecc(text, convertReverseMap[variant]) : simplecc(text, variant);
};

export { initSimpleCC, runSimpleCC };
