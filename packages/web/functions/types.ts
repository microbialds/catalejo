// The subset of the Cloudflare Pages Functions and R2 interfaces the
// Functions use, declared here so the package needs no Workers type
// dependency. The names follow @cloudflare/workers-types.

export interface R2HTTPMetadata {
  contentType?: string;
}

/** An object's metadata, as returned by R2Bucket.head. */
export interface R2Object {
  key: string;
  size: number;
  /** The ETag in quoted form, ready for the ETag header. */
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
}

/** An object with its body, as returned by R2Bucket.get. */
export interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

/** The bindings of the Pages project (wrangler configuration or dashboard). */
export interface Env {
  /** The R2 bucket that holds the releases and the /assets/ prefix. */
  RELEASES?: R2Bucket;
}

export interface EventContext<E, P extends string> {
  request: Request;
  env: E;
  /** Route parameters; a catch-all parameter holds its segments as an array. */
  params: Partial<Record<P, string | string[]>>;
  /** The next Function, or the static asset for the request. */
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
}

export type PagesFunction<E = Env, P extends string = string> = (
  context: EventContext<E, P>,
) => Response | Promise<Response>;
