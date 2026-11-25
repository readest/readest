interface Field {
  id: number;
  /** Where the field starts, and where its value does. */
  from: number;
  start: number;
  end: number;
}

// The protobuf fields of an ONNX model.
const MODEL_GRAPH = 7;
const GRAPH_NODE = 1;
const GRAPH_INITIALIZER = 5;
const GRAPH_INPUT = 11;
const GRAPH_OUTPUT = 12;
const GRAPH_VALUE_INFO = 13;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const TENSOR_NAME = 8;
const VALUE_NAME = 1;
const FLOAT_TENSOR_TYPE = Uint8Array.of(0x12, 4, 0x0a, 2, 0x08, 1);

const readFields = (bytes: Uint8Array, { start, end }: Pick<Field, 'start' | 'end'>): Field[] => {
  const fields: Field[] = [];
  let position = start;
  const readVarint = (): number => {
    let value = 0;
    for (let scale = 1; ; scale *= 128) {
      const byte = bytes[position++]!;
      value += (byte & 127) * scale;
      if (!(byte >= 128)) return value;
    }
  };
  while (position < end) {
    const from = position;
    const tag = readVarint();
    if (tag % 8 === 2) {
      const length = readVarint();
      fields.push({ id: tag >> 3, from, start: position, end: position + length });
      position += length;
    } else if (tag % 8 === 0) {
      readVarint();
    } else {
      position += tag % 8 === 1 ? 8 : 4;
    }
  }
  return fields;
};

const makeField = (id: number, ...values: Uint8Array[]): Uint8Array[] => {
  const header = [id * 8 + 2];
  let length = values.reduce((sum, value) => sum + value.length, 0);
  for (; length > 127; length = Math.floor(length / 128)) header.push((length % 128) + 128);
  header.push(length);
  return [Uint8Array.from(header), ...values];
};

/** Keeps what computes `outputs`, all floats, for an input of any size. */
export const trimOnnxModel = (model: ArrayBuffer, outputs: readonly string[]): ArrayBuffer => {
  const bytes = new Uint8Array(model);
  const all = { start: 0, end: bytes.length };
  const graph = readFields(bytes, all).find(({ id }) => id === MODEL_GRAPH)!;
  const fields = readFields(bytes, graph);
  const decoder = new TextDecoder();
  const readNames = (field: Field, nameId: number): string[] =>
    readFields(bytes, field)
      .filter(({ id }) => id === nameId)
      .map(({ start, end }) => decoder.decode(bytes.subarray(start, end)));

  const nodes = new Map<string, Field>();
  for (const field of fields) {
    if (field.id !== GRAPH_NODE) continue;
    for (const output of readNames(field, NODE_OUTPUT)) nodes.set(output, field);
  }
  const names = new Set(outputs);
  const kept = new Set<Field>();
  // A set also goes over what's added on the way.
  for (const name of names) {
    const node = nodes.get(name);
    if (!node) continue;
    kept.add(node);
    for (const input of readNames(node, NODE_INPUT)) names.add(input);
  }

  const encoder = new TextEncoder();
  const makeValue = (id: number, name: string) =>
    makeField(id, ...makeField(VALUE_NAME, encoder.encode(name)), FLOAT_TENSOR_TYPE);
  const parts = outputs.flatMap((name) => makeValue(GRAPH_OUTPUT, name));
  for (const field of fields) {
    if (field.id === GRAPH_OUTPUT || field.id === GRAPH_VALUE_INFO) continue;
    if (field.id === GRAPH_NODE && !kept.has(field)) continue;
    if (field.id === GRAPH_INITIALIZER && !names.has(readNames(field, TENSOR_NAME)[0]!)) continue;
    if (field.id === GRAPH_INPUT) {
      parts.push(...makeValue(GRAPH_INPUT, readNames(field, VALUE_NAME)[0]!));
    } else {
      parts.push(bytes.subarray(field.from, field.end));
    }
  }
  const trimmed = [
    bytes.subarray(0, graph.from),
    ...makeField(MODEL_GRAPH, ...parts),
    bytes.subarray(graph.end),
  ];
  const result = new Uint8Array(trimmed.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of trimmed) {
    result.set(part, offset);
    offset += part.length;
  }
  return result.buffer;
};
