// Writes src/generated/ from config/palette.yaml and config/design-tokens.yaml
// (requirements §5.4 and §7). Run with `pnpm generate`; predev, prebuild,
// pretest and pretypecheck run it too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderGenerated, webRoot } from './generate-lib.ts';

const files = await renderGenerated();
for (const file of files) {
  const target = path.join(webRoot, file.path);
  mkdirSync(path.dirname(target), { recursive: true });
  let current: string | undefined;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = undefined;
  }
  if (current !== file.content) {
    writeFileSync(target, file.content);
    console.log(`generate: wrote ${file.path}`);
  }
}
