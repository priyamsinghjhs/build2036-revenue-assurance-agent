// Minimal runtime types so the Worker typechecks without generated wrangler types.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Fetcher {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

type BufferSource = ArrayBufferView | ArrayBuffer;
interface CryptoKey {}
interface SubtleCrypto {
  importKey(format: string, keyData: BufferSource, algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<CryptoKey>;
  encrypt(algorithm: { name: string; iv: BufferSource }, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: { name: string; iv: BufferSource }, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  sign(algorithm: unknown, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>;
  digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
}
interface Crypto {
  randomUUID(): string;
  getRandomValues<T extends Uint8Array>(array: T): T;
  subtle: SubtleCrypto;
}
declare const crypto: Crypto;
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare class TextEncoder { encode(input?: string): Uint8Array; }
declare class TextDecoder { constructor(label?: string, options?: { fatal?: boolean }); decode(input?: ArrayBuffer | Uint8Array): string; }
declare class URLSearchParams {
  constructor(init?: Record<string, string> | string);
  set(name: string, value: string): void;
  entries(): IterableIterator<[string, string]>;
}
declare class URL {
  constructor(url: string, base?: string | URL);
  readonly searchParams: URLSearchParams;
  readonly origin: string;
  readonly pathname: string;
  readonly protocol: string;
  readonly host: string;
  toString(): string;
}
declare class AbortSignal { static timeout(ms: number): AbortSignal; }
declare function fetch(input: string, init?: RequestInit): Promise<Response>;


interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
}

interface ResponseInit {
  status?: number;
  headers?: Record<string, string>;
}

declare class Request {
  constructor(input: string | Request, init?: RequestInit);
}

declare class Response {
  constructor(body?: string, init?: ResponseInit);
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): Response;
}

interface Cache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface CacheStorage {
  readonly default: Cache;
}

declare const caches: CacheStorage;


interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
  type: "scheduled";
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
