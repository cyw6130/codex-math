#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { deriveMathState, CAPABILITY_ID } = require('../vendor/math-graph-semantics-v3/src/index.js');
const [paper, map, output] = process.argv.slice(2);
if (!paper || !map || !output) { console.error('Usage: validate-map.mjs PAPER MAP OUTPUT'); process.exit(2); }
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(paper), mapBytes = readFileSync(map);
const report = {source_sha256:sha(source), map_sha256:sha(mapBytes), validator:CAPABILITY_ID, errors:[]};
try { report.derived = deriveMathState(JSON.parse(mapBytes.toString('utf8'))); }
catch (e) { report.errors.push({code:e.code || 'INVALID_MAP', message:e.message}); }
writeFileSync(output, JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report));
if (report.errors.length) process.exitCode = 1;
