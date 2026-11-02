import path from 'node:path';

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export function readContractLimits() {
  return {
    maxBytes: integer('CONTRACT_MAX_BYTES', 100 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    maxPages: integer('CONTRACT_MAX_PAGES', 300, 1, 1000),
    maxCharacters: integer('CONTRACT_MAX_CHARACTERS', 600000, 100, 2000000),
    parserOutputBytes: integer('CONTRACT_PARSER_OUTPUT_BYTES', 12 * 1024 * 1024, 10000, 32 * 1024 * 1024),
    parserTimeoutMs: integer('CONTRACT_PARSER_TIMEOUT_MS', 90000, 50, 180000),
    parserHeapMb: integer('CONTRACT_PARSER_HEAP_MB', 384, 64, 1024),
    parserConcurrency: integer('CONTRACT_PARSER_CONCURRENCY', 2, 1, 4),
    uploadTimeoutMs: integer('CONTRACT_UPLOAD_TIMEOUT_MS', 180000, 50, 600000),
    taskTimeoutMs: integer('CONTRACT_TASK_TIMEOUT_MS', 12 * 60000, 100, 30 * 60000),
    ttlMs: integer('CONTRACT_TTL_MS', 15 * 60000, 100, 60 * 60000),
    quotaBytes: integer('CONTRACT_TEMP_QUOTA_BYTES', 512 * 1024 * 1024, 10000, 4 * 1024 ** 3),
    freeMarginBytes: integer('CONTRACT_DISK_MARGIN_BYTES', 256 * 1024 * 1024, 0, 4 * 1024 ** 3),
    chunkCharacters: integer('CONTRACT_CHUNK_CHARACTERS', 10000, 500, 20000),
    overlapCharacters: integer('CONTRACT_OVERLAP_CHARACTERS', 500, 0, 1000),
    sharedCharacters: integer('CONTRACT_SHARED_CHARACTERS', 1200, 0, 2000),
    maxInputCharacters: integer('CONTRACT_INPUT_CHARACTERS', 16000, 4000, 32000),
    outputTokens: integer('CONTRACT_OUTPUT_TOKENS', 3600, 600, 6000),
    maxChunks: integer('CONTRACT_MAX_CHUNKS', 64, 1, 128),
    maxCalls: integer('CONTRACT_MAX_MODEL_CALLS', 96, 1, 256),
    blockConcurrency: integer('CONTRACT_BLOCK_CONCURRENCY', 2, 1, 3),
    blockRetries: integer('CONTRACT_BLOCK_RETRIES', 1, 0, 2),
    tempRoot: path.resolve(process.env.CONTRACT_TEMP_ROOT || path.join(__dirname, '../../.private/contracts-v1'))
  };
}
export type ContractLimits = ReturnType<typeof readContractLimits>;
