import { neon } from "@neondatabase/serverless";
import type { Env } from "./types";

/** Minimal D1-like surface over Neon HTTP so existing query call sites stay simple. */
export type AppStatement = {
  bind(...values: unknown[]): AppStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type AppDb = {
  prepare(query: string): AppStatement;
};

function toPgPlaceholders(query: string): string {
  let n = 0;
  return query.replace(/\?/g, () => `$${++n}`);
}

export function getDb(env: Env): AppDb {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (Neon connection string)");
  }
  const sql = neon(url);
  return {
    prepare(query: string) {
      const text = toPgPlaceholders(query);
      let params: unknown[] = [];
      const stmt: AppStatement = {
        bind(...values: unknown[]) {
          params = values;
          return stmt;
        },
        async first<T = unknown>() {
          const rows = (await sql.query(text, params)) as T[];
          return rows[0] ?? null;
        },
        async all<T = unknown>() {
          const rows = (await sql.query(text, params)) as T[];
          return { results: rows ?? [] };
        },
        async run() {
          await sql.query(text, params);
        },
      };
      return stmt;
    },
  };
}
