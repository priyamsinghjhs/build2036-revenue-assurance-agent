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

interface Crypto { randomUUID(): string; }
declare const crypto: Crypto;

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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
  text(): Promise<string>;
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
