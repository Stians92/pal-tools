// Test the Oodle port against real Palworld saves.
const fs = require('fs');
const path = require('path');
const { oodleDecompress } = require('../src/oodle.js');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node test-oodle.js <file.sav> ...');
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const data = fs.readFileSync(file);
  let off = 0;
  let uncompressedLen = data.readUInt32LE(0);
  let compressedLen = data.readUInt32LE(4);
  let magic = data.toString('latin1', 8, 11);
  let saveType = data[11];
  off = 12;
  if (magic === 'CNK') {
    uncompressedLen = data.readUInt32LE(12);
    compressedLen = data.readUInt32LE(16);
    magic = data.toString('latin1', 20, 23);
    saveType = data[23];
    off = 24;
  }
  process.stdout.write(`${path.basename(file)}: magic=${magic} type=0x${saveType.toString(16)} comp=${compressedLen} uncomp=${uncompressedLen} ... `);
  if (magic !== 'PlM') { console.log('SKIP (not PlM)'); continue; }

  const t0 = Date.now();
  try {
    const out = oodleDecompress(new Uint8Array(data.buffer, data.byteOffset + off, data.length - off), uncompressedLen);
    const ms = Date.now() - t0;
    const gvasMagic = Buffer.from(out.slice(0, 4)).toString('latin1');
    if (gvasMagic === 'GVAS' && out.length === uncompressedLen) {
      console.log(`OK (${ms} ms, GVAS magic present)`);
    } else {
      console.log(`FAIL (magic=${JSON.stringify(gvasMagic)}, len=${out.length})`);
      failed++;
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
