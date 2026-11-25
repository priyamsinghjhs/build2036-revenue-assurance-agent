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
  verify(algorithm: unknown, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean>;
  digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
  deriveBits(algorithm: unknown, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>;
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
  readonly hostname: string;
  username: string;
  password: string;
  toString(): string;
}
declare class AbortSignal { static timeout(ms: number): AbortSignal; }
declare function fetch(input: string, init?: RequestInit): Promise<Response>;


interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | URLSearchParams;
  signal?: AbortSignal;
  redirect?: "follow" | "manual" | "error";
}

interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: Headers | Record<string, string>;
}

declare class Request {
  constructor(input: string | Request, init?: RequestInit);
  readonly url: string;
  readonly method: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Headers {
  constructor(init?: Headers | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  append(name: string, value: string): void;
  entries(): IterableIterator<[string, string]>;
}

interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: Headers | Record<string, string>;
}

declare class Response {
  constructor(body?: BodyInit | string | null, init?: ResponseInit);
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): Response;
}

type BodyInit = ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | string;


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
  props?: unknown;
}

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void; warn(...args: unknown[]): void; };
