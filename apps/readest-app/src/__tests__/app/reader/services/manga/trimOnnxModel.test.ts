import { InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { expect, it } from 'vitest';

import { trimOnnxModel } from '@/plugins/ocr/trimOnnxModel';

const field = (id: number, ...values: (number | string | Uint8Array)[]): Uint8Array => {
  const value = values.flatMap((part) =>
    typeof part === 'number' ? [part] : [...(typeof part === 'string' ? encode(part) : part)],
  );
  const { length } = value;
  const size = length > 127 ? [(length % 128) + 128, length >> 7] : [length];
  return Uint8Array.of(id * 8 + 2, ...size, ...value);
};
const encode = (text: string) => new TextEncoder().encode(text);
const node = (type: string, inputs: string[], output: string) =>
  field(1, ...inputs.map((input) => field(1, input)), field(2, output), field(4, type));
const floats = (id: number, name: string, size: number) =>
  field(id, field(1, name), field(2, field(1, 8, 1, field(2, field(1, 8, size)))));
const two = (name: string) =>
  field(5, 8, 1, 16, 1, field(8, name), field(9, new Uint8Array(Float32Array.of(2).buffer)));

// y = -2x and z = |x| + 2, of two numbers.
const MODEL = Uint8Array.of(
  ...[8, 8],
  ...field(
    7,
    node('Mul', ['x', 'a'], 'm'),
    node('Neg', ['m'], 'y'),
    node('Abs', ['x'], 'n'),
    node('Add', ['n', 'b'], 'z'),
    field(2, 'graph'),
    two('a'),
    two('b'),
    floats(11, 'x', 2),
    floats(12, 'y', 2),
    floats(12, 'z', 2),
  ),
  ...field(8, 16, 13),
).buffer;

it('keeps what an output needs, for an input of any size', async () => {
  const trimmed = trimOnnxModel(MODEL, ['m']);
  const session = await InferenceSession.create(trimmed);

  expect(session.inputNames).toEqual(['x']);
  expect(session.outputNames).toEqual(['m']);
  const { m } = await session.run({ x: new Tensor('float32', [1, 2, 3], [3]) });
  expect([...(m!.data as Float32Array)]).toEqual([2, 4, 6]);
  const text = new TextDecoder('latin1').decode(trimmed);
  expect(text).toContain('Mul');
  expect(text).not.toMatch(/Neg|Abs|Add/);
});
