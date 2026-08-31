import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('desktop server smoke enforces the fresh-install license gate', async () => {
  const source = await readFile('scripts/desktop-test-server.mjs', 'utf8');

  assert.doesNotMatch(source, /throw new Error\(['"]defaults missing['"]\)/);
  assert.match(source, /bootstrap[\s\S]*?402[\s\S]*?LICENSE_REQUIRED/);
});
