import init, { simplecc } from '@simplecc/simplecc_wasm';

let initialized = false;

const initSimpleCC = async () => {
  if (initialized) return;

  await init('/vendor/simplecc/simplecc_wasm_bg.wasm');
  initialized = true;
};

export { simplecc, initSimpleCC };
