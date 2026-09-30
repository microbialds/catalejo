// Globals replaced at build time by the `define` option in vite.config.ts.

/** The installed @duckdb/duckdb-wasm version, read from its package.json. */
declare const __DUCKDB_WASM_VERSION__: string;

// CGView.js ships no type declarations. This is the part of its API the
// application and tests use (node_modules/cgview/dist/cgview.esm.js, 1.8.2).
declare module 'cgview' {
  /** The installed CGView.js version; map JSON declares it as cgview.version. */
  export const version: string;

  export interface Contig {
    readonly name: string;
    readonly length: number;
    readonly mapStart: number;
    readonly visible: boolean;
  }

  export interface LegendItem {
    readonly name: string;
  }

  export interface Feature {
    readonly name: string;
    readonly type: string;
    readonly source: string;
    readonly start: number;
    readonly stop: number;
    readonly mapStart: number;
    readonly mapStop: number;
    readonly strand: 1 | -1;
    /** Undefined when the contig named in the JSON does not exist. */
    readonly contig: Contig | undefined;
    readonly legend: LegendItem;
    readonly meta: Readonly<Record<string, unknown>>;
    readonly tags: readonly string[];
    tracks(): readonly Track[];
  }

  export interface Plot {
    readonly name: string;
    readonly source: string;
    readonly positions: readonly number[];
    readonly scores: readonly number[];
    readonly baseline: number;
    readonly legendPositive: LegendItem;
    readonly legendNegative: LegendItem;
    tracks(): readonly Track[];
  }

  export interface Track {
    readonly name: string;
    readonly dataType: 'feature' | 'plot';
    readonly dataMethod: 'source' | 'type' | 'tag' | 'sequence';
    /** Undefined when the JSON value was not valid for the data type. */
    readonly position: 'inside' | 'outside' | 'around' | 'along' | undefined;
    readonly itemCount: number;
    readonly plot: Plot | undefined;
    features(): readonly Feature[];
  }

  export interface Sequence {
    readonly length: number;
    readonly hasMultipleContigs: boolean;
    contigs(): readonly Contig[];
  }

  export interface Legend {
    items(): readonly LegendItem[];
  }

  export interface IO {
    /** Replaces the map with the document; throws on an unreadable one. */
    loadJSON(json: unknown): void;
    toJSON(options?: { includeDefaults?: boolean }): { cgview: Record<string, unknown> };
    /** Needs ViewerOptions.SVGContext (svgcanvas Context). */
    getSVG(): string | undefined;
  }

  export interface ViewerOptions {
    width?: number;
    height?: number;
    /** svgcanvas's Context class, for IO.getSVG. */
    SVGContext?: unknown;
  }

  export class Viewer {
    /** containerId is an element id, with or without '#'. */
    constructor(containerId: string, options?: ViewerOptions);
    readonly io: IO;
    readonly sequence: Sequence;
    readonly legend: Legend;
    features(): readonly Feature[];
    plots(): readonly Plot[];
    tracks(): readonly Track[];
    resize(width: number, height: number): void;
    draw(fast?: boolean): void;
    drawFull(): void;
    on(event: string, callback: (data: unknown) => void): void;
    off(event: string, callback?: (data: unknown) => void): void;
  }
}
