#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'public/calculator-catalogs.js'));
const calculator = JSON.parse(fs.readFileSync(path.join(root, 'data/catalogs/calculator.json'), 'utf8'));
const equipment = JSON.parse(fs.readFileSync(path.join(root, 'data/catalogs/equipment.json'), 'utf8'));
const payload = { calculator, equipment };
const source = 'window.CESAR_CALCULATOR_CATALOGS = Object.freeze(' + JSON.stringify(payload, null, 2) + ');\n';

fs.writeFileSync(output, source);
