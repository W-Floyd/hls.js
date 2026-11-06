#!/usr/bin/env node
/* eslint-env node */
'use strict';

/**
 * Writes dist/hls.auto.d.ts (and .d.mts) for the auto loader from tsc's
 * declarations in lib/: the public types plus the entry's exports, in one file
 * whose only import is the package's own `hls.js` types. api-extractor isn't
 * used because it inlines a second copy of Hls, which (having private members)
 * would not be assignable to the package's Hls.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) =>
  fs
    .readFileSync(path.join(ROOT, 'lib', file), 'utf8')
    .replace(/^\/\/# sourceMappingURL=.*$/m, '');

const lines = (read('auto-types.d.ts') + read('exports-auto.d.ts'))
  // The entry's imports and re-exports of the types this file now declares.
  .replace(/^(import|export) type \{[^}]*\} from '\.\/auto-types';\n/gm, '')
  .split('\n');
const imports = [...new Set(lines.filter((line) => /^import /.test(line)))];
const body = lines.filter((line) => !/^import /.test(line)).join('\n');
const output = `${imports.join('\n')}\n${body.trim()}\n`;

if (/from '\.\.?\//.test(output)) {
  throw new Error('dist/hls.auto.d.ts would contain a relative import');
}
['hls.auto.d.ts', 'hls.auto.d.mts'].forEach((file) =>
  fs.writeFileSync(path.join(ROOT, 'dist', file), output),
);
