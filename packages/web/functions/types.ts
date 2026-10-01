// The subset of the Cloudflare Pages Functions and R2 interfaces the
// Functions use, declared here so the package needs no Workers type
// dependency. The names follow @cloudflare/workers-types.

export interface R2HTTPMetadata {
  contentType?: string;
}

/** A byte range of an object: from an offset, of a length, or the last bytes. */
export type R2Range =
  { offset: number; length?: number } | { offset?: number; length: number } | { suffix: number };

export interface R2GetOptions {
  range?: R2Range;
}

/** An object's metadata, as returned by R2Bucket.head. */
export interface R2Object {
  key: string;
  /** The size of the whole object, also when a range was read. */
  size: number;
  /** The ETag in quoted form, ready for the ETag header. */
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
  /** The range that was read, when R2Bucket.get was given one. */
  range?: R2Range;
}

/** An object with its body, as returned by R2Bucket.get. */
export interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
}

export interface R2Bucket {
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

/** The bindings of the Pages project (wrangler configuration or dashboard). */
export interface Env {
  /** The R2 bucket that holds the releases and the /assets/ prefix. */
  RELEASES?: R2Bucket;
  /**
   * The group whose release this instance serves, or empty (or unset) for
   * the main instance, which serves the full collection.
   */
  CATALEJO_GROUP?: string;
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
