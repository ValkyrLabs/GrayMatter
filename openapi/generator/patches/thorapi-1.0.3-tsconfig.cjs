'use strict';
const fs = require('node:fs');
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
// Patch the extracted, static ThorAPI template before generation. Keep all
// framework aliases and any newer package-specific compiler inputs.
config.compilerOptions.paths['@thorapi/model'] = ['./src/models/index.ts'];
config.compilerOptions.paths['@thorapi/model/*'] = ['./src/models/*'];
for (const directory of ['src', 'redux', 'utils', 'types']) {
  if (!config.include.includes(directory)) config.include.push(directory);
}
fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
