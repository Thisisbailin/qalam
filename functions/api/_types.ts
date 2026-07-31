export type D1RunResult = {
  results?: Record<string, unknown>[];
  meta?: {
    changes?: number;
  };
};

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1RunResult & { results?: T[] }>;
  run(): Promise<D1RunResult>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]>;
}

export type PagesContext<Env> = {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
};
