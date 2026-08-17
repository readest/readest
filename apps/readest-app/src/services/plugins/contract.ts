import { z } from 'zod';

export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export const MAX_PLUGIN_RESOURCE_BYTES = 4 * 1_024 * 1_024;
export const MAX_PLUGIN_SQL_PARAMS = 9_000;
export const MAX_PLUGIN_SQL_PARAMETER_BYTES = MAX_PLUGIN_RESOURCE_BYTES;
export const MAX_PLUGIN_SQL_REQUEST_BYTES = MAX_PLUGIN_RESOURCE_BYTES * 2;
export const MAX_PLUGIN_ERROR_CODE_LENGTH = 128;
export const MAX_PLUGIN_ERROR_MESSAGE_LENGTH = 4_000;

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

const opaqueHandleSchema = z.string().min(1).max(256);

export const dictionaryFormatContributionSchema = z.strictObject({
  id: identifierSchema,
  extensions: z
    .array(z.string().regex(/^[a-z0-9]+$/u))
    .min(1)
    .max(16),
  indexVersion: z.number().int().positive(),
  materialization: z.enum(['sql', 'database']),
});

export const pluginManifestSchema = z.strictObject({
  id: identifierSchema,
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  pluginVersion: z.string().min(1).max(64),
  builtAt: z.iso.datetime().optional(),
  contributions: z.strictObject({
    dictionaryFormats: z.array(dictionaryFormatContributionSchema).min(1).max(16),
  }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

const sourceRefSchema = z.strictObject({
  handle: opaqueHandleSchema,
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
});

const requestEnvelope = {
  kind: z.literal('request'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
};

const probeRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('probe'),
  payload: z.strictObject({
    sources: z.array(sourceRefSchema).min(1).max(16),
  }),
});

const inspectRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('inspect'),
  payload: z.strictObject({
    sourceHandle: opaqueHandleSchema,
  }),
});

const buildIndexRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('buildIndex'),
  payload: z.strictObject({
    dictionaryId: identifierSchema,
    sourceHandle: opaqueHandleSchema,
    databaseHandle: opaqueHandleSchema,
    sourceFormatVersion: z.number().int().positive(),
  }),
});

const verifyIndexRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('verifyIndex'),
  payload: z.strictObject({
    dictionaryId: identifierSchema,
    databaseHandle: opaqueHandleSchema,
  }),
});

const lookupRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('lookup'),
  payload: z.strictObject({
    dictionaryId: identifierSchema,
    databaseHandle: opaqueHandleSchema,
    query: z.string().min(1).max(512),
    language: z.string().min(2).max(35).optional(),
  }),
});

const readResourceRequestSchema = z.strictObject({
  ...requestEnvelope,
  operation: z.literal('readResource'),
  payload: z.strictObject({
    dictionaryId: identifierSchema,
    sourceHandle: opaqueHandleSchema,
    databaseHandle: opaqueHandleSchema,
    resourceRef: z.string().min(1).max(512),
  }),
});

export const pluginRequestSchema = z.discriminatedUnion('operation', [
  probeRequestSchema,
  inspectRequestSchema,
  buildIndexRequestSchema,
  verifyIndexRequestSchema,
  lookupRequestSchema,
  readResourceRequestSchema,
]);

export type PluginRequest = z.infer<typeof pluginRequestSchema>;
export type PluginOperation = PluginRequest['operation'];
export type PluginRequestFor<T extends PluginOperation> = Extract<PluginRequest, { operation: T }>;
export type PluginPayload<T extends PluginOperation> = PluginRequestFor<T>['payload'];

const dictionaryTextNodeSchema = z.strictObject({
  type: z.literal('text'),
  value: z.string().max(100_000),
});

const dictionaryLineBreakNodeSchema = z.strictObject({
  type: z.literal('lineBreak'),
});

const dictionaryElementTagSchema = z.enum([
  'p',
  'span',
  'div',
  'ruby',
  'rt',
  'rp',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'ol',
  'ul',
  'li',
  'details',
  'summary',
]);

const dictionaryStyleSchema = z.strictObject({
  fontStyle: z.enum(['normal', 'italic']).optional(),
  fontWeight: z.enum(['normal', 'bold']).optional(),
  textDecorationLine: z.enum(['none', 'underline', 'line-through']).optional(),
  verticalAlign: z
    .enum(['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle'])
    .optional(),
  textAlign: z.enum(['start', 'end', 'left', 'right', 'center']).optional(),
});

const lookupLinkTargetSchema = z.strictObject({
  type: z.literal('lookup'),
  word: z.string().min(1).max(512),
});

const externalLinkTargetSchema = z
  .strictObject({
    type: z.literal('external'),
    url: z.url(),
  })
  .refine(({ url }) => {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  }, 'Only HTTP(S) dictionary links are allowed');

const dictionaryImageNodeSchema = z.strictObject({
  type: z.literal('image'),
  resourceRef: z.string().min(1).max(512),
  alt: z.string().max(2_000).optional(),
  title: z.string().max(2_000).optional(),
  width: z.number().positive().max(8_192).optional(),
  height: z.number().positive().max(8_192).optional(),
  sizeUnits: z.enum(['px', 'em']).optional(),
  imageRendering: z.enum(['auto', 'pixelated', 'crisp-edges']).optional(),
  appearance: z.enum(['auto', 'monochrome']).optional(),
});

const dictionaryLinkNodeSchema = z.strictObject({
  type: z.literal('link'),
  label: z.string().min(1).max(4_000),
  target: z.discriminatedUnion('type', [lookupLinkTargetSchema, externalLinkTargetSchema]),
});

interface DictionaryElementNode {
  type: 'element';
  tag: z.infer<typeof dictionaryElementTagSchema>;
  children: DictionaryContentNode[];
  title?: string;
  open?: boolean;
  lang?: string;
  colSpan?: number;
  rowSpan?: number;
  style?: z.infer<typeof dictionaryStyleSchema>;
}

export type DictionaryContentNode =
  | z.infer<typeof dictionaryTextNodeSchema>
  | z.infer<typeof dictionaryLineBreakNodeSchema>
  | z.infer<typeof dictionaryImageNodeSchema>
  | z.infer<typeof dictionaryLinkNodeSchema>
  | DictionaryElementNode;

export const dictionaryContentNodeSchema: z.ZodType<DictionaryContentNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    dictionaryTextNodeSchema,
    dictionaryLineBreakNodeSchema,
    dictionaryImageNodeSchema,
    dictionaryLinkNodeSchema,
    z.strictObject({
      type: z.literal('element'),
      tag: dictionaryElementTagSchema,
      children: z.array(dictionaryContentNodeSchema).max(2_000),
      title: z.string().max(2_000).optional(),
      open: z.boolean().optional(),
      lang: z.string().min(2).max(35).optional(),
      colSpan: z.number().int().min(1).max(100).optional(),
      rowSpan: z.number().int().min(1).max(100).optional(),
      style: dictionaryStyleSchema.optional(),
    }),
  ]),
);

export const dictionaryTagSchema = z.strictObject({
  name: z.string().min(1).max(256),
  category: z.string().max(256).optional(),
  notes: z.string().max(4_000).optional(),
  score: z.number().optional(),
});

export const dictionaryFrequencySchema = z.strictObject({
  value: z.union([z.number(), z.string().max(512)]),
  displayValue: z.string().max(512).optional(),
});

export const dictionaryPitchSchema = z.strictObject({
  position: z.union([z.number().int().nonnegative(), z.string().regex(/^[HL]+$/u)]),
  nasal: z
    .union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative())])
    .optional(),
  devoice: z
    .union([z.number().int().nonnegative(), z.array(z.number().int().nonnegative())])
    .optional(),
  tags: z.array(z.string().max(256)).max(64).optional(),
});

export const dictionaryIpaSchema = z.strictObject({
  value: z.string().min(1).max(2_000),
  tags: z.array(z.string().max(256)).max(64).optional(),
});

export const dictionaryLookupEntrySchema = z.strictObject({
  expression: z.string().min(1).max(512),
  reading: z.string().max(512),
  rules: z.array(z.string().max(128)).max(64).optional(),
  score: z.number().optional(),
  deinflection: z.array(z.string().max(256)).max(32).optional(),
  tags: z.array(dictionaryTagSchema).max(128).optional(),
  frequencies: z.array(dictionaryFrequencySchema).max(128).optional(),
  pitches: z.array(dictionaryPitchSchema).max(128).optional(),
  ipa: z.array(dictionaryIpaSchema).max(128).optional(),
  definitions: z.array(dictionaryContentNodeSchema).max(2_000),
});

export const dictionaryLookupResultSchema = z.strictObject({
  entries: z.array(dictionaryLookupEntrySchema).max(128),
});

export type DictionaryLookupResult = z.infer<typeof dictionaryLookupResultSchema>;
export type DictionaryLookupEntry = z.infer<typeof dictionaryLookupEntrySchema>;

export const MAX_DICTIONARY_DOCUMENT_DEPTH = 16;
export const MAX_DICTIONARY_DOCUMENT_NODES = 1_024;

const assertDocumentLimits = (result: DictionaryLookupResult): void => {
  let nodes = 0;
  const visit = (node: DictionaryContentNode, depth: number): void => {
    if (depth > MAX_DICTIONARY_DOCUMENT_DEPTH) {
      throw new Error(`Dictionary document exceeds maximum depth ${MAX_DICTIONARY_DOCUMENT_DEPTH}`);
    }
    nodes += 1;
    if (nodes > MAX_DICTIONARY_DOCUMENT_NODES) {
      throw new Error(`Dictionary document exceeds maximum nodes ${MAX_DICTIONARY_DOCUMENT_NODES}`);
    }
    if (node.type === 'element') {
      for (const child of node.children) visit(child, depth + 1);
    }
  };

  for (const entry of result.entries) {
    for (const definition of entry.definitions) visit(definition, 1);
  }
};

export const parseDictionaryLookupResult = (value: unknown): DictionaryLookupResult => {
  const result = dictionaryLookupResultSchema.parse(value);
  assertDocumentLimits(result);
  return result;
};

const probeResultSchema = z.strictObject({
  matches: z
    .array(
      z.strictObject({
        sourceHandle: opaqueHandleSchema,
        formatId: identifierSchema,
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(16),
});

const inspectResultSchema = z.strictObject({
  formatId: identifierSchema,
  sourceFormatVersion: z.number().int().positive(),
  title: z.string().min(1).max(1_024),
  revision: z.string().max(1_024).optional(),
  language: z.string().min(2).max(35).optional(),
  sequenced: z.boolean().optional(),
});

const buildIndexResultSchema = z.strictObject({
  indexVersion: z.number().int().positive(),
  entries: z.number().int().nonnegative(),
  resources: z.number().int().nonnegative(),
});

const verifyIndexResultSchema = z.strictObject({
  indexVersion: z.number().int().positive(),
  entries: z.number().int().nonnegative(),
  title: z.string().min(1).max(1_024).optional(),
});

const resourceBytesSchema = z
  .instanceof(Uint8Array)
  .refine(
    (bytes) => bytes.byteLength <= MAX_PLUGIN_RESOURCE_BYTES,
    'Dictionary resource exceeds the protocol byte limit',
  );

const resourceMimeTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu);

const readResourceResultSchema = z.strictObject({
  mimeType: resourceMimeTypeSchema,
  bytes: resourceBytesSchema,
});

export interface PluginResultByOperation {
  probe: z.infer<typeof probeResultSchema>;
  inspect: z.infer<typeof inspectResultSchema>;
  buildIndex: z.infer<typeof buildIndexResultSchema>;
  verifyIndex: z.infer<typeof verifyIndexResultSchema>;
  lookup: DictionaryLookupResult;
  readResource: z.infer<typeof readResourceResultSchema>;
}

export type PluginResult<T extends PluginOperation> = PluginResultByOperation[T];

export const parsePluginOperationResult = <T extends PluginOperation>(
  operation: T,
  value: unknown,
): PluginResult<T> => {
  let result: PluginResultByOperation[PluginOperation];
  switch (operation) {
    case 'probe':
      result = probeResultSchema.parse(value);
      break;
    case 'inspect':
      result = inspectResultSchema.parse(value);
      break;
    case 'buildIndex':
      result = buildIndexResultSchema.parse(value);
      break;
    case 'verifyIndex':
      result = verifyIndexResultSchema.parse(value);
      break;
    case 'lookup':
      result = parseDictionaryLookupResult(value);
      break;
    case 'readResource':
      result = readResourceResultSchema.parse(value);
      break;
  }
  return result as PluginResult<T>;
};

export const normalizePluginErrorPayload = (
  code: unknown,
  message: unknown,
): { code: string; message: string } => ({
  code:
    (typeof code === 'string' ? code : String(code)).slice(0, MAX_PLUGIN_ERROR_CODE_LENGTH) ||
    'UNKNOWN_ERROR',
  message:
    (typeof message === 'string' ? message : String(message)).slice(
      0,
      MAX_PLUGIN_ERROR_MESSAGE_LENGTH,
    ) || 'Plugin operation failed',
});

const errorPayloadSchema = z.strictObject({
  code: z.string().min(1).max(MAX_PLUGIN_ERROR_CODE_LENGTH),
  message: z.string().min(1).max(MAX_PLUGIN_ERROR_MESSAGE_LENGTH),
});

const responseEnvelope = {
  kind: z.literal('response'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
};

const pluginSuccessResponseSchema = z.strictObject({
  ...responseEnvelope,
  ok: z.literal(true),
  result: z.unknown(),
});

const pluginErrorResponseSchema = z.strictObject({
  ...responseEnvelope,
  ok: z.literal(false),
  error: errorPayloadSchema,
});

export const pluginResponseSchema = z.discriminatedUnion('ok', [
  pluginSuccessResponseSchema,
  pluginErrorResponseSchema,
]);

const cancelRequestSchema = z.strictObject({
  kind: z.literal('cancel'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
});

const sqlValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.bigint(),
  z.boolean(),
  z.null(),
  z.instanceof(Uint8Array),
]);

export type PluginSqlValue = z.infer<typeof sqlValueSchema>;

export const pluginSqlValueBytes = (value: unknown): number => {
  if (value === null) return 0;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  if (typeof value === 'number') return 8;
  if (typeof value === 'bigint') {
    const bits = value === 0n ? 1 : value.toString(2).replace('-', '').length;
    return Math.ceil(bits / 8);
  }
  if (typeof value === 'boolean') return 1;
  if (value instanceof Uint8Array) return value.byteLength;
  throw new TypeError('Unsupported SQL parameter type');
};

const boundedSqlValueSchema = sqlValueSchema.superRefine((value, context) => {
  if (pluginSqlValueBytes(value) > MAX_PLUGIN_SQL_PARAMETER_BYTES) {
    context.addIssue({ code: 'custom', message: 'SQL parameter cell size limit exceeded' });
  }
});

const sqlParamsSchema = z
  .array(boundedSqlValueSchema)
  .max(MAX_PLUGIN_SQL_PARAMS)
  .superRefine((params, context) => {
    if (
      params.reduce<number>((total, value) => total + pluginSqlValueBytes(value), 0) >
      MAX_PLUGIN_SQL_REQUEST_BYTES
    ) {
      context.addIssue({ code: 'custom', message: 'SQL parameter payload size limit exceeded' });
    }
  })
  .optional();

const hostCallEnvelope = {
  kind: z.literal('host-call'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
  callId: z.string().min(1).max(256),
};

const sourceStatCallSchema = z.strictObject({
  ...hostCallEnvelope,
  capability: z.literal('source.stat'),
  payload: z.strictObject({ handle: opaqueHandleSchema }),
});

const sourceReadRangeCallSchema = z.strictObject({
  ...hostCallEnvelope,
  capability: z.literal('source.readRange'),
  payload: z.strictObject({
    handle: opaqueHandleSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
  }),
});

const sqlExecuteCallSchema = z.strictObject({
  ...hostCallEnvelope,
  capability: z.literal('sql.execute'),
  payload: z.strictObject({
    handle: opaqueHandleSchema,
    sql: z.string().min(1).max(65_536),
    params: sqlParamsSchema,
  }),
});

const sqlSelectCallSchema = z.strictObject({
  ...hostCallEnvelope,
  capability: z.literal('sql.select'),
  payload: z.strictObject({
    handle: opaqueHandleSchema,
    sql: z.string().min(1).max(65_536),
    params: sqlParamsSchema,
    maxRows: z.number().int().min(1).max(1_000),
  }),
});

const transactionStatementSchema = z.strictObject({
  sql: z.string().min(1).max(65_536),
  params: sqlParamsSchema,
});

const transactionStatementsSchema = z
  .array(transactionStatementSchema)
  .min(1)
  .max(64)
  .superRefine((statements, context) => {
    const totalBytes = statements.reduce<number>(
      (total, statement) =>
        total +
        (statement.params ?? []).reduce<number>(
          (statementTotal, value) => statementTotal + pluginSqlValueBytes(value),
          0,
        ),
      0,
    );
    if (totalBytes > MAX_PLUGIN_SQL_REQUEST_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'SQL transaction parameter size limit exceeded',
      });
    }
  });

const sqlTransactionCallSchema = z.strictObject({
  ...hostCallEnvelope,
  capability: z.literal('sql.transaction'),
  payload: z.strictObject({
    handle: opaqueHandleSchema,
    statements: transactionStatementsSchema,
  }),
});

export const pluginHostCallSchema = z.discriminatedUnion('capability', [
  sourceStatCallSchema,
  sourceReadRangeCallSchema,
  sqlExecuteCallSchema,
  sqlSelectCallSchema,
  sqlTransactionCallSchema,
]);

export type PluginHostCall = z.infer<typeof pluginHostCallSchema>;

const progressMessageSchema = z.strictObject({
  kind: z.literal('progress'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
  stage: z.string().min(1).max(128),
  completed: z.number().nonnegative(),
  total: z.number().nonnegative().optional(),
});

const hostResultEnvelope = {
  kind: z.literal('host-result'),
  protocolVersion: z.literal(PLUGIN_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(256),
  callId: z.string().min(1).max(256),
};

const hostSuccessResultSchema = z.strictObject({
  ...hostResultEnvelope,
  ok: z.literal(true),
  result: z.unknown(),
});

const hostErrorResultSchema = z.strictObject({
  ...hostResultEnvelope,
  ok: z.literal(false),
  error: errorPayloadSchema,
});

export const pluginHostResultSchema = z.discriminatedUnion('ok', [
  hostSuccessResultSchema,
  hostErrorResultSchema,
]);

export const pluginWorkerInboundMessageSchema = z.union([
  pluginRequestSchema,
  cancelRequestSchema,
  pluginHostResultSchema,
]);

export const pluginWorkerOutboundMessageSchema = z.union([
  pluginResponseSchema,
  pluginHostCallSchema,
  progressMessageSchema,
]);

export type PluginResponse = z.infer<typeof pluginResponseSchema>;
export type PluginProgress = z.infer<typeof progressMessageSchema>;
export type PluginHostResult = z.infer<typeof pluginHostResultSchema>;
export type PluginWorkerInboundMessage = z.infer<typeof pluginWorkerInboundMessageSchema>;
export type PluginWorkerOutboundMessage = z.infer<typeof pluginWorkerOutboundMessageSchema>;
