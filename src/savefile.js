// savefile.js — outer .sav container handling (header parse + decompression dispatch).
// PlM (Oodle) → src/oodle.js port. PlZ (zlib) → not yet implemented (from-scratch
// inflate planned; current-generation Palworld saves are all PlM).

'use strict';

(() => {

const isNode = typeof module !== 'undefined' && module.exports;
const oodleDecompressFn = isNode ? require('./oodle.js').oodleDecompress
                                 : (...a) => globalThis.PalTools.oodleDecompress(...a);

function parseSavHeader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 0;
  let uncompressedLen = dv.getUint32(0, true);
  let compressedLen = dv.getUint32(4, true);
  let magic = String.fromCharCode(u8[8], u8[9], u8[10]);
  let saveType = u8[11];
  off = 12;
  if (magic === 'CNK') {
    uncompressedLen = dv.getUint32(12, true);
    compressedLen = dv.getUint32(16, true);
    magic = String.fromCharCode(u8[20], u8[21], u8[22]);
    saveType = u8[23];
    off = 24;
  }
  return { uncompressedLen, compressedLen, magic, saveType, dataOffset: off };
}

// Returns the raw GVAS bytes.
function decompressSav(u8) {
  const hdr = parseSavHeader(u8);
  const payload = u8.subarray(hdr.dataOffset);
  if (hdr.magic === 'PlM') {
    return oodleDecompress(payload, hdr.uncompressedLen);
  }
  if (hdr.magic === 'PlZ') {
    throw new Error('PlZ (zlib) saves not supported yet');
  }
  throw new Error(`unknown save magic ${JSON.stringify(hdr.magic)}`);
}

function oodleDecompress(payload, len) { return oodleDecompressFn(payload, len); }

const api = { parseSavHeader, decompressSav };
if (isNode) module.exports = api;
else globalThis.PalTools = Object.assign(globalThis.PalTools || {}, api);

})();
