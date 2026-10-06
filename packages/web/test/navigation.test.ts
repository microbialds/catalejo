// Requirements §5.1 and §5.7: which navigation items a manifest disables, the
// product of each route, and the en-US formatting of the footer values.
import { describe, expect, it } from 'vitest';
import { formatCount, formatPipeline } from '../src/format';
import { hasProduct, navigation, productOfRoute } from '../src/navigation';
import type { Product } from '../src/navigation';
import { matchRoute } from '../src/router';
import { manifestFixture, manifestWithProducts } from './support/manifest';

const products: Product[] = ['trees', 'pangenome', 'embeddings', 'search'];

describe('hasProduct', () => {
  it('finds no optional product in the synthetic release', () => {
    const manifest = manifestFixture();
    expect(products.filter((product) => hasProduct(manifest, product))).toEqual([]);
  });

  it('finds trees, pangenomes and embeddings when declared, never search', () => {
    const manifest = manifestWithProducts();
    expect(products.filter((product) => hasProduct(manifest, product))).toEqual([
      'trees',
      'pangenome',
      'embeddings',
    ]);
  });

  it('reads each product from its own manifest field', () => {
    const base = manifestFixture();
    const withTree = manifestFixture({
      species: base.species.map((s, i) => (i === 1 ? { ...s, tree_ids: ['ECO-core'] } : s)),
    });
    expect(products.filter((product) => hasProduct(withTree, product))).toEqual(['trees']);
    const withPangenome = manifestFixture({
      species: base.species.map((s, i) => (i === 1 ? { ...s, has_pangenome: true } : s)),
    });
    expect(products.filter((product) => hasProduct(withPangenome, product))).toEqual(['pangenome']);
    const withEmbeddings = manifestFixture({
      embedding_models: [{ model: 'm', model_version: '1', dim: 8, genome_count: 100 }],
    });
    expect(products.filter((product) => hasProduct(withEmbeddings, product))).toEqual([
      'embeddings',
    ]);
  });
});

describe('navigation model', () => {
  it('ties each Analyze item to its product and route', () => {
    const analyze = navigation.find((group) => group.id === 'analyze');
    expect(
      analyze?.items.map((item) => [item.product, productOfRoute(matchRoute(item.href))]),
    ).toEqual(products.map((product) => [product, product]));
  });

  it('gives Explore items no product', () => {
    const explore = navigation.find((group) => group.id === 'explore');
    expect(explore?.items.map((item) => item.product)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(productOfRoute(matchRoute('/genomes/KPN0001'))).toBeUndefined();
  });
});

describe('formatting', () => {
  it('groups thousands in en-US', () => {
    expect(formatCount(100)).toBe('100');
    expect(formatCount(4812)).toBe('4,812');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('joins the pipeline name and versions', () => {
    expect(formatPipeline({ name: 'gene2dis/mgap', versions: ['2.0.0'] })).toBe(
      'gene2dis/mgap 2.0.0',
    );
    expect(formatPipeline({ name: 'gene2dis/mgap', versions: ['2.0.0', '2.1.0'] })).toBe(
      'gene2dis/mgap 2.0.0, 2.1.0',
    );
    expect(formatPipeline({ name: 'gene2dis/mgap', versions: [] })).toBe('gene2dis/mgap');
  });
});
