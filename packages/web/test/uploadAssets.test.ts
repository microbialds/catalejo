// The asset upload command (scripts/upload-assets.mjs; requirements §9 and
// §10): the engine files the application requests and the pinned extension
// repository go to <remote>:<bucket>/assets/ with rclone. The tests check the
// command plan in dry-run mode, which needs no rclone.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUCKET,
  DEFAULT_REMOTE,
  missingSources,
  pinnedExtensionFiles,
  planUploads,
  rcloneCommand,
  requestedEngineFiles,
  shellLine,
} from '../scripts/upload-assets.mjs';
import { DUCKDB_WASM_FILES, duckdbWasmVersion } from '../vite/duckdbAssets';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(webRoot, 'scripts', 'upload-assets.mjs');
const version = duckdbWasmVersion(webRoot);

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: webRoot,
    encoding: 'utf8',
    env: { HOME: process.env.HOME, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('planUploads', () => {
  it('sends the engine under its version and the extensions with their layout', () => {
    const uploads = planUploads({
      remote: 'r2',
      bucket: 'catalejo-releases',
      version: '1.32.0',
      distDir: '/dist',
      engineFiles: ['duckdb-eh.wasm'],
      extensionsDir: '/cache/ext',
      extensionFiles: ['v1.4.3/wasm_eh/parquet.duckdb_extension.wasm'],
    });
    expect(uploads).toEqual([
      {
        source: path.join('/dist', 'duckdb-eh.wasm'),
        target: 'r2:catalejo-releases/assets/duckdb-wasm/1.32.0/duckdb-eh.wasm',
      },
      {
        source: path.join('/cache/ext', 'v1.4.3', 'wasm_eh', 'parquet.duckdb_extension.wasm'),
        target:
          'r2:catalejo-releases/assets/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm',
      },
    ]);
    expect(rcloneCommand(uploads[0] ?? { source: '', target: '' })).toEqual([
      'rclone',
      'copyto',
      '--checksum',
      path.join('/dist', 'duckdb-eh.wasm'),
      'r2:catalejo-releases/assets/duckdb-wasm/1.32.0/duckdb-eh.wasm',
    ]);
  });

  it('reports the sources that are missing', () => {
    const uploads = planUploads({
      remote: 'r2',
      bucket: 'b',
      version,
      distDir: path.join(webRoot, 'no-such-dir'),
      engineFiles: ['duckdb-eh.wasm'],
      extensionsDir: webRoot,
      extensionFiles: ['package.json'],
    });
    expect(missingSources(uploads)).toEqual([path.join(webRoot, 'no-such-dir', 'duckdb-eh.wasm')]);
  });

  it('quotes a shell line only where needed', () => {
    expect(shellLine(['rclone', 'copyto', '/a b/c', "r2:x/it's"])).toBe(
      `rclone copyto '/a b/c' 'r2:x/it'\\''s'`,
    );
  });
});

describe('the uploaded files', () => {
  it('are the main modules and workers of engineBundles', async () => {
    const files = await requestedEngineFiles(version);
    expect([...files].sort()).toEqual([...DUCKDB_WASM_FILES].sort());
  });

  it('include every pinned extension', () => {
    const files = pinnedExtensionFiles();
    expect(files).toContain('v1.4.3/wasm_eh/parquet.duckdb_extension.wasm');
    expect(files).toHaveLength(4);
    for (const file of files)
      expect(file).toMatch(/^v[^/]+\/wasm_[a-z]+\/\w+\.duckdb_extension\.wasm$/);
  });
});

describe('scripts/upload-assets.mjs', () => {
  it('prints the rclone commands in a dry run, without rclone on PATH', () => {
    const { status, stdout, stderr } = run(
      ['--', '--dry-run', '--remote', 'test', '--bucket', 'test-bucket'],
      {
        PATH: '',
      },
    );
    expect(stderr).toBe('');
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    const commands = lines.filter((line) => line.startsWith('rclone '));
    expect(commands).toHaveLength(8);
    for (const line of commands)
      expect(line).toMatch(/^rclone copyto --checksum \S+ test:test-bucket\/assets\//);
    for (const file of DUCKDB_WASM_FILES) {
      expect(
        commands.some((line) =>
          line.endsWith(`test:test-bucket/assets/duckdb-wasm/${version}/${file}`),
        ),
      ).toBe(true);
    }
    expect(commands.filter((line) => line.includes('/assets/duckdb-extensions/v'))).toHaveLength(4);
    expect(lines.at(-1)).toMatch(/dry run, 8 files, nothing uploaded/);
  });

  it('defaults the remote and bucket, and reads them from the environment', () => {
    const defaults = run(['--dry-run']);
    expect(defaults.stdout).toContain(` ${DEFAULT_REMOTE}:${DEFAULT_BUCKET}/assets/duckdb-wasm/`);
    const fromEnv = run(['--dry-run'], { CATALEJO_R2_REMOTE: 'other', CATALEJO_R2_BUCKET: 'b-2' });
    expect(fromEnv.stdout).toContain(' other:b-2/assets/');
    const flagsWin = run(['--dry-run', '--bucket', 'b-3'], { CATALEJO_R2_BUCKET: 'b-2' });
    expect(flagsWin.stdout).toContain(` ${DEFAULT_REMOTE}:b-3/assets/`);
  });

  it('fails with a clear message when rclone is missing', () => {
    const { status, stdout, stderr } = run([], { PATH: '' });
    expect(status).toBe(1);
    expect(stderr).toMatch(/rclone is not installed/);
    expect(stdout).toBe('');
  });

  it('refuses a bucket or remote that is not a name', () => {
    expect(run(['--dry-run', '--bucket', 'a/b']).status).toBe(1);
    expect(run(['--dry-run', '--remote', 'r2:x']).status).toBe(1);
  });
});
