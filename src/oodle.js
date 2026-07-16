// oodle.js — Oodle Kraken/Mermaid/Selkie DECOMPRESSOR, from-scratch JavaScript port
// of the open-source ooz reimplementation (powzix/ooz, GPL-3.0). Decompression only.
// License: GPL-3.0 (derivative of ooz).
//
// Port model: flat memory. All C pointers become integer offsets into a single
// Uint8Array heap (`mem`) laid out as [pad | src | scratch | dst | slack], so
// pointer identity/arithmetic translates 1:1. Multi-byte reads/writes go through
// a DataView (little-endian, matching x86 semantics the original relies on).
// 64-bit copies replicate C's load-all-then-store semantics exactly (COPY_64
// reads all 8 bytes before writing, which matters for overlapping LZ copies).
//
// Scope: decoder types 6 (Kraken) and 10 (Mermaid/Selkie) — the ones Palworld
// uses — plus all shared entropy stages (Huffman, TANS, RLE, recursive,
// multi-array). LZNA (5), Bitknit (11) and Leviathan (12) are not ported and
// throw. Quantum checksums are parsed but not verified.

'use strict';

(() => {

let mem = null; // Uint8Array heap
let dv = null;  // DataView over mem.buffer

// ---- primitive memory access -------------------------------------------------

function u16(p) { return dv.getUint16(p, true); }
function u32(p) { return dv.getUint32(p, true); }
function i32(p) { return dv.getInt32(p, true); }
function wu16(p, v) { dv.setUint16(p, v, true); }
function wu32(p, v) { dv.setUint32(p, v, true); }
function wi32(p, v) { dv.setInt32(p, v, true); }

function u16be(p) { return dv.getUint16(p, false); }
function u32be(p) { return dv.getUint32(p, false); }

// COPY_64(d, s): *(uint64*)d = *(uint64*)s — full 8-byte load happens before the store.
function copy64(d, s) {
  const a = u32(s), b = u32(s + 4);
  wu32(d, a); wu32(d + 4, b);
}

// COPY_64_BYTES(d, s): four sequential 16-byte load/store pairs.
function copy64bytes(d, s) {
  for (let i = 0; i < 64; i += 16) {
    const a = u32(s + i), b = u32(s + i + 4), c = u32(s + i + 8), e = u32(s + i + 12);
    wu32(d + i, a); wu32(d + i + 4, b); wu32(d + i + 8, c); wu32(d + i + 12, e);
  }
}

// COPY_64_ADD(d, s, t): d[i] = (s[i] + t[i]) & 0xFF for i in 0..7 (loads before stores).
function copy64add(d, s, t) {
  let b0 = mem[s] + mem[t], b1 = mem[s + 1] + mem[t + 1], b2 = mem[s + 2] + mem[t + 2], b3 = mem[s + 3] + mem[t + 3];
  let b4 = mem[s + 4] + mem[t + 4], b5 = mem[s + 5] + mem[t + 5], b6 = mem[s + 6] + mem[t + 6], b7 = mem[s + 7] + mem[t + 7];
  mem[d] = b0; mem[d + 1] = b1; mem[d + 2] = b2; mem[d + 3] = b3;
  mem[d + 4] = b4; mem[d + 5] = b5; mem[d + 6] = b6; mem[d + 7] = b7;
}

function memmove(d, s, n) { mem.copyWithin(d, s, s + n); }
function memset(d, v, n) { mem.fill(v, d, d + n); }

// ---- bit scan helpers ----------------------------------------------------------

// BSR: index of highest set bit (x must be nonzero)
function BSR(x) { return 31 - Math.clz32(x); }
// BSF: index of lowest set bit (x must be nonzero)
function BSF(x) { return 31 - Math.clz32(x & -x); }
function CountLeadingZeros(x) { return Math.clz32(x); }
function Log2RoundUp(v) { return v > 1 ? 32 - Math.clz32(v - 1) : 0; }
function rotl32(x, n) { n &= 31; return n === 0 ? x >>> 0 : ((x << n) | (x >>> (32 - n))) >>> 0; }

// ---- BitReader -----------------------------------------------------------------
// Fields: p, p_end (heap offsets), bits (uint32), bitpos (int).

function BitReader_Refill(br) {
  while (br.bitpos > 0) {
    br.bits = (br.bits | ((br.p < br.p_end ? mem[br.p] : 0) << br.bitpos)) >>> 0;
    br.bitpos -= 8;
    br.p++;
  }
}

function BitReader_RefillBackwards(br) {
  while (br.bitpos > 0) {
    br.p--;
    br.bits = (br.bits | ((br.p >= br.p_end ? mem[br.p] : 0) << br.bitpos)) >>> 0;
    br.bitpos -= 8;
  }
}

function BitReader_ReadBit(br) {
  BitReader_Refill(br);
  const r = br.bits >>> 31;
  br.bits = (br.bits << 1) >>> 0;
  br.bitpos += 1;
  return r;
}

function BitReader_ReadBitNoRefill(br) {
  const r = br.bits >>> 31;
  br.bits = (br.bits << 1) >>> 0;
  br.bitpos += 1;
  return r;
}

// n in [1..24] (n=32 would be UB in C too)
function BitReader_ReadBitsNoRefill(br, n) {
  const r = br.bits >>> (32 - n);
  br.bits = (br.bits << n) >>> 0;
  br.bitpos += n;
  return r;
}

// n may be zero
function BitReader_ReadBitsNoRefillZero(br, n) {
  const r = (br.bits >>> 1) >>> (31 - n);
  br.bits = (br.bits << n) >>> 0;
  br.bitpos += n;
  return r;
}

function BitReader_ReadMoreThan24Bits(br, n) {
  let rv;
  if (n <= 24) {
    rv = BitReader_ReadBitsNoRefillZero(br, n);
  } else {
    rv = (BitReader_ReadBitsNoRefill(br, 24) << (n - 24)) >>> 0;
    BitReader_Refill(br);
    rv = (rv + BitReader_ReadBitsNoRefill(br, n - 24)) >>> 0;
  }
  BitReader_Refill(br);
  return rv;
}

function BitReader_ReadMoreThan24BitsB(br, n) {
  let rv;
  if (n <= 24) {
    rv = BitReader_ReadBitsNoRefillZero(br, n);
  } else {
    rv = (BitReader_ReadBitsNoRefill(br, 24) << (n - 24)) >>> 0;
    BitReader_RefillBackwards(br);
    rv = (rv + BitReader_ReadBitsNoRefill(br, n - 24)) >>> 0;
  }
  BitReader_RefillBackwards(br);
  return rv;
}

// Assumes at least 23 bits available. Returns value - 2.
function BitReader_ReadGamma(br) {
  let n;
  if (br.bits !== 0) {
    n = 31 - BSR(br.bits);
  } else {
    n = 32;
  }
  n = 2 * n + 2;
  br.bitpos += n;
  const r = br.bits >>> (32 - n);
  br.bits = (br.bits << n) >>> 0;
  return r - 2;
}

function BitReader_ReadGammaX(br, forced) {
  if (br.bits !== 0) {
    const lz = 31 - BSR(br.bits);
    const r = ((br.bits >>> (31 - lz - forced)) + ((lz - 1) << forced)) >>> 0;
    br.bits = (br.bits << (lz + forced + 1)) >>> 0;
    br.bitpos += lz + forced + 1;
    return r;
  }
  return 0;
}

function BitReader_ReadDistance(br, v) {
  let w, m, n, rv;
  if (v < 0xF0) {
    n = (v >>> 4) + 4;
    w = rotl32((br.bits | 1) >>> 0, n);
    br.bitpos += n;
    m = ((2 << n) - 1) >>> 0;
    br.bits = (w & ~m) >>> 0;
    rv = (((w & m) << 4) >>> 0) + (v & 0xF) - 248;
  } else {
    n = v - 0xF0 + 4;
    w = rotl32((br.bits | 1) >>> 0, n);
    br.bitpos += n;
    m = ((2 << n) - 1) >>> 0;
    br.bits = (w & ~m) >>> 0;
    rv = 8322816 + (((w & m) * 4096) >>> 0);
    BitReader_Refill(br);
    rv = (rv + (br.bits >>> 20)) >>> 0;
    br.bitpos += 12;
    br.bits = (br.bits << 12) >>> 0;
  }
  BitReader_Refill(br);
  return rv >>> 0;
}

function BitReader_ReadDistanceB(br, v) {
  let w, m, n, rv;
  if (v < 0xF0) {
    n = (v >>> 4) + 4;
    w = rotl32((br.bits | 1) >>> 0, n);
    br.bitpos += n;
    m = ((2 << n) - 1) >>> 0;
    br.bits = (w & ~m) >>> 0;
    rv = (((w & m) << 4) >>> 0) + (v & 0xF) - 248;
  } else {
    n = v - 0xF0 + 4;
    w = rotl32((br.bits | 1) >>> 0, n);
    br.bitpos += n;
    m = ((2 << n) - 1) >>> 0;
    br.bits = (w & ~m) >>> 0;
    rv = 8322816 + (((w & m) * 4096) >>> 0);
    BitReader_RefillBackwards(br);
    rv = (rv + (br.bits >>> 20)) >>> 0;
    br.bitpos += 12;
    br.bits = (br.bits << 12) >>> 0;
  }
  BitReader_RefillBackwards(br);
  return rv >>> 0;
}

// Returns length or -1 (C returned bool + out param)
function BitReader_ReadLength(br) {
  let n = 31 - BSR(br.bits);
  if (n > 12) return -1;
  br.bitpos += n;
  br.bits = (br.bits << n) >>> 0;
  BitReader_Refill(br);
  n += 7;
  br.bitpos += n;
  const rv = (br.bits >>> (32 - n)) - 64;
  br.bits = (br.bits << n) >>> 0;
  BitReader_Refill(br);
  return rv;
}

function BitReader_ReadLengthB(br) {
  let n = 31 - BSR(br.bits);
  if (n > 12) return -1;
  br.bitpos += n;
  br.bits = (br.bits << n) >>> 0;
  BitReader_RefillBackwards(br);
  n += 7;
  br.bitpos += n;
  const rv = (br.bits >>> (32 - n)) - 64;
  br.bits = (br.bits << n) >>> 0;
  BitReader_RefillBackwards(br);
  return rv;
}

// ---- block/quantum headers -----------------------------------------------------

// Returns new src offset, fills hdr; 0 on error.
function Kraken_ParseHeader(hdr, p) {
  let b = mem[p];
  if ((b & 0xF) === 0xC) {
    if (((b >>> 4) & 3) !== 0) return 0;
    hdr.restart_decoder = (b >>> 7) & 1;
    hdr.uncompressed = (b >>> 6) & 1;
    b = mem[p + 1];
    hdr.decoder_type = b & 0x7F;
    hdr.use_checksums = (b >>> 7) !== 0;
    if (hdr.decoder_type !== 6 && hdr.decoder_type !== 10 && hdr.decoder_type !== 5 &&
        hdr.decoder_type !== 11 && hdr.decoder_type !== 12)
      return 0;
    return p + 2;
  }
  return 0;
}

// Returns new src offset, fills qhdr; 0 on error.
function Kraken_ParseQuantumHeader(qhdr, p, use_checksum) {
  const v = (mem[p] << 16) | (mem[p + 1] << 8) | mem[p + 2];
  const size = v & 0x3FFFF;
  if (size !== 0x3FFFF) {
    qhdr.compressed_size = size + 1;
    qhdr.flag1 = (v >>> 18) & 1;
    qhdr.flag2 = (v >>> 19) & 1;
    if (use_checksum) {
      qhdr.checksum = (mem[p + 3] << 16) | (mem[p + 4] << 8) | mem[p + 5];
      return p + 6;
    }
    return p + 3;
  }
  const vv = v >>> 18;
  if (vv === 1) {
    // memset quantum
    qhdr.checksum = mem[p + 3];
    qhdr.compressed_size = 0;
    qhdr.whole_match_distance = 0;
    return p + 4;
  }
  return 0;
}

// ---- scratch "stack" allocator (for C stack arrays, lives in heap) -------------

let stackPtr = 0, stackLimit = 0;

function salloc(n) {
  const p = (stackPtr + 15) & ~15;
  stackPtr = p + n;
  if (stackPtr > stackLimit) throw new Error('oodle: stack overflow');
  return p;
}

// ---- CRC (checksums parsed but not verified) -----------------------------------

function Kraken_GetCrc(p, size) { return 0; }

// ---- ReverseBitsArray2048 --------------------------------------------------------
// Permutes a 2048-entry array so 11-bit indices are bit-reversed (self-inverse).

const rev11 = new Uint16Array(2048);
for (let i = 0; i < 2048; i++) {
  let r = 0, x = i;
  for (let b = 0; b < 11; b++) { r = (r << 1) | (x & 1); x >>= 1; }
  rev11[i] = r;
}

function ReverseBitsArray2048(input, output) {
  for (let i = 0; i < 2048; i++) mem[output + rev11[i]] = mem[input + i];
}

// ---- Huffman core ----------------------------------------------------------------
// HuffReader hr: {output, output_end, src, src_mid, src_end, src_mid_org,
//                 src_bitpos, src_mid_bitpos, src_end_bitpos,
//                 src_bits, src_mid_bits, src_end_bits}
// lut_bits2len / lut_bits2sym: heap pointers (2048 entries each)

function Kraken_DecodeBytesCore(hr, lut_bits2len, lut_bits2sym) {
  let src = hr.src;
  let src_bits = hr.src_bits >>> 0;
  let src_bitpos = hr.src_bitpos;

  let src_mid = hr.src_mid;
  let src_mid_bits = hr.src_mid_bits >>> 0;
  let src_mid_bitpos = hr.src_mid_bitpos;

  let src_end = hr.src_end;
  let src_end_bits = hr.src_end_bits >>> 0;
  let src_end_bitpos = hr.src_end_bitpos;

  let k, n;

  let dst = hr.output;
  let dst_end = hr.output_end;

  if (src > src_mid)
    return false;

  if (hr.src_end - src_mid >= 4 && dst_end - dst >= 6) {
    dst_end -= 5;
    src_end -= 4;

    while (dst < dst_end && src <= src_mid && src_mid <= src_end) {
      src_bits = (src_bits | (u32(src) << src_bitpos)) >>> 0;
      src += (31 - src_bitpos) >> 3;

      src_end_bits = (src_end_bits | (u32be(src_end) << src_end_bitpos)) >>> 0;
      src_end -= (31 - src_end_bitpos) >> 3;

      src_mid_bits = (src_mid_bits | (u32(src_mid) << src_mid_bitpos)) >>> 0;
      src_mid += (31 - src_mid_bitpos) >> 3;

      src_bitpos |= 0x18;
      src_end_bitpos |= 0x18;
      src_mid_bitpos |= 0x18;

      k = src_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_bits = src_bits >>> n;
      src_bitpos -= n;
      mem[dst] = mem[lut_bits2sym + k];

      k = src_end_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_end_bits = src_end_bits >>> n;
      src_end_bitpos -= n;
      mem[dst + 1] = mem[lut_bits2sym + k];

      k = src_mid_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_mid_bits = src_mid_bits >>> n;
      src_mid_bitpos -= n;
      mem[dst + 2] = mem[lut_bits2sym + k];

      k = src_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_bits = src_bits >>> n;
      src_bitpos -= n;
      mem[dst + 3] = mem[lut_bits2sym + k];

      k = src_end_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_end_bits = src_end_bits >>> n;
      src_end_bitpos -= n;
      mem[dst + 4] = mem[lut_bits2sym + k];

      k = src_mid_bits & 0x7FF;
      n = mem[lut_bits2len + k];
      src_mid_bits = src_mid_bits >>> n;
      src_mid_bitpos -= n;
      mem[dst + 5] = mem[lut_bits2sym + k];
      dst += 6;
    }
    dst_end += 5;

    src -= src_bitpos >> 3;
    src_bitpos &= 7;

    src_end += 4 + (src_end_bitpos >> 3);
    src_end_bitpos &= 7;

    src_mid -= src_mid_bitpos >> 3;
    src_mid_bitpos &= 7;
  }
  for (;;) {
    if (dst >= dst_end)
      break;

    if (src_mid - src <= 1) {
      if (src_mid - src === 1)
        src_bits = (src_bits | (mem[src] << src_bitpos)) >>> 0;
    } else {
      src_bits = (src_bits | (u16(src) << src_bitpos)) >>> 0;
    }
    k = src_bits & 0x7FF;
    n = mem[lut_bits2len + k];
    src_bitpos -= n;
    src_bits = src_bits >>> n;
    mem[dst++] = mem[lut_bits2sym + k];
    src += (7 - src_bitpos) >> 3;
    src_bitpos &= 7;

    if (dst < dst_end) {
      if (src_end - src_mid <= 1) {
        if (src_end - src_mid === 1) {
          src_end_bits = (src_end_bits | (mem[src_mid] << src_end_bitpos)) >>> 0;
          src_mid_bits = (src_mid_bits | (mem[src_mid] << src_mid_bitpos)) >>> 0;
        }
      } else {
        const v = u16(src_end - 2);
        src_end_bits = (src_end_bits | ((((v >>> 8) | (v << 8)) & 0xFFFF) << src_end_bitpos)) >>> 0;
        src_mid_bits = (src_mid_bits | (u16(src_mid) << src_mid_bitpos)) >>> 0;
      }
      n = mem[lut_bits2len + (src_end_bits & 0x7FF)];
      mem[dst++] = mem[lut_bits2sym + (src_end_bits & 0x7FF)];
      src_end_bitpos -= n;
      src_end_bits = src_end_bits >>> n;
      src_end -= (7 - src_end_bitpos) >> 3;
      src_end_bitpos &= 7;
      if (dst < dst_end) {
        n = mem[lut_bits2len + (src_mid_bits & 0x7FF)];
        mem[dst++] = mem[lut_bits2sym + (src_mid_bits & 0x7FF)];
        src_mid_bitpos -= n;
        src_mid_bits = src_mid_bits >>> n;
        src_mid += (7 - src_mid_bitpos) >> 3;
        src_mid_bitpos &= 7;
      }
    }
    if (src > src_mid || src_mid > src_end)
      return false;
  }
  if (src !== hr.src_mid_org || src_end !== src_mid)
    return false;
  return true;
}

// syms: heap ptr (1280 bytes). code_prefix: Uint32Array(12) (JS-side).
function Huff_ReadCodeLengthsOld(bits, syms, code_prefix) {
  if (BitReader_ReadBitNoRefill(bits)) {
    let n, sym = 0, codelen, num_symbols = 0;
    let avg_bits_x4 = 32;
    const forced_bits = BitReader_ReadBitsNoRefill(bits, 2);

    const thres_for_valid_gamma_bits = (1 << (31 - (20 >>> forced_bits))) >>> 0;
    let skip_initial_zeros = BitReader_ReadBit(bits) !== 0;
    do {
      if (!skip_initial_zeros) {
        // Run of zeros
        if (!(bits.bits & 0xFF000000)) return -1;
        sym += BitReader_ReadBitsNoRefill(bits, 2 * (CountLeadingZeros(bits.bits) + 1)) - 2 + 1;
        if (sym >= 256) break;
      }
      skip_initial_zeros = false;
      BitReader_Refill(bits);
      // Read out the gamma value for the # of symbols
      if (!(bits.bits & 0xFF000000)) return -1;
      n = BitReader_ReadBitsNoRefill(bits, 2 * (CountLeadingZeros(bits.bits) + 1)) - 2 + 1;
      // Overflow?
      if (sym + n > 256) return -1;
      BitReader_Refill(bits);
      num_symbols += n;
      do {
        if (bits.bits < thres_for_valid_gamma_bits)
          return -1; // too big gamma value?

        const lz = CountLeadingZeros(bits.bits);
        const v = BitReader_ReadBitsNoRefill(bits, lz + forced_bits + 1) + ((lz - 1) << forced_bits);
        codelen = (-(v & 1) ^ (v >> 1)) + ((avg_bits_x4 + 2) >> 2);
        if (codelen < 1 || codelen > 11) return -1;
        avg_bits_x4 = codelen + ((3 * avg_bits_x4 + 2) >> 2);
        BitReader_Refill(bits);
        mem[syms + code_prefix[codelen]++] = sym++;
      } while (--n);
    } while (sym !== 256);
    return (sym === 256) && (num_symbols >= 2) ? num_symbols : -1;
  } else {
    // Sparse symbol encoding
    const num_symbols = BitReader_ReadBitsNoRefill(bits, 8);
    if (num_symbols === 0) return -1;
    if (num_symbols === 1) {
      mem[syms] = BitReader_ReadBitsNoRefill(bits, 8);
    } else {
      const codelen_bits = BitReader_ReadBitsNoRefill(bits, 3);
      if (codelen_bits > 4) return -1;
      for (let i = 0; i < num_symbols; i++) {
        BitReader_Refill(bits);
        const sym = BitReader_ReadBitsNoRefill(bits, 8);
        const codelen = BitReader_ReadBitsNoRefillZero(bits, codelen_bits) + 1;
        if (codelen > 11) return -1;
        mem[syms + code_prefix[codelen]++] = sym;
      }
    }
    return num_symbols;
  }
}

function BitReader_ReadFluff(bits, num_symbols) {
  if (num_symbols === 256) return 0;

  let x = 257 - num_symbols;
  if (x > num_symbols) x = num_symbols;

  x *= 2;

  const y = BSR(x - 1) + 1;

  const v = bits.bits >>> (32 - y);
  const z = ((1 << y) >>> 0) - x;

  if ((v >>> 1) >= z) {
    bits.bits = (bits.bits << y) >>> 0;
    bits.bitpos += y;
    return v - z;
  } else {
    bits.bits = (bits.bits << (y - 1)) >>> 0;
    bits.bitpos += (y - 1);
    return v >>> 1;
  }
}

const kRiceCodeBits2Value = new Uint32Array([
  0x80000000, 0x00000007, 0x10000006, 0x00000006, 0x20000005, 0x00000105, 0x10000005, 0x00000005,
  0x30000004, 0x00000204, 0x10000104, 0x00000104, 0x20000004, 0x00010004, 0x10000004, 0x00000004,
  0x40000003, 0x00000303, 0x10000203, 0x00000203, 0x20000103, 0x00010103, 0x10000103, 0x00000103,
  0x30000003, 0x00020003, 0x10010003, 0x00010003, 0x20000003, 0x01000003, 0x10000003, 0x00000003,
  0x50000002, 0x00000402, 0x10000302, 0x00000302, 0x20000202, 0x00010202, 0x10000202, 0x00000202,
  0x30000102, 0x00020102, 0x10010102, 0x00010102, 0x20000102, 0x01000102, 0x10000102, 0x00000102,
  0x40000002, 0x00030002, 0x10020002, 0x00020002, 0x20010002, 0x01010002, 0x10010002, 0x00010002,
  0x30000002, 0x02000002, 0x11000002, 0x01000002, 0x20000002, 0x00000012, 0x10000002, 0x00000002,
  0x60000001, 0x00000501, 0x10000401, 0x00000401, 0x20000301, 0x00010301, 0x10000301, 0x00000301,
  0x30000201, 0x00020201, 0x10010201, 0x00010201, 0x20000201, 0x01000201, 0x10000201, 0x00000201,
  0x40000101, 0x00030101, 0x10020101, 0x00020101, 0x20010101, 0x01010101, 0x10010101, 0x00010101,
  0x30000101, 0x02000101, 0x11000101, 0x01000101, 0x20000101, 0x00000111, 0x10000101, 0x00000101,
  0x50000001, 0x00040001, 0x10030001, 0x00030001, 0x20020001, 0x01020001, 0x10020001, 0x00020001,
  0x30010001, 0x02010001, 0x11010001, 0x01010001, 0x20010001, 0x00010011, 0x10010001, 0x00010001,
  0x40000001, 0x03000001, 0x12000001, 0x02000001, 0x21000001, 0x01000011, 0x11000001, 0x01000001,
  0x30000001, 0x00000021, 0x10000011, 0x00000011, 0x20000001, 0x00001001, 0x10000001, 0x00000001,
  0x70000000, 0x00000600, 0x10000500, 0x00000500, 0x20000400, 0x00010400, 0x10000400, 0x00000400,
  0x30000300, 0x00020300, 0x10010300, 0x00010300, 0x20000300, 0x01000300, 0x10000300, 0x00000300,
  0x40000200, 0x00030200, 0x10020200, 0x00020200, 0x20010200, 0x01010200, 0x10010200, 0x00010200,
  0x30000200, 0x02000200, 0x11000200, 0x01000200, 0x20000200, 0x00000210, 0x10000200, 0x00000200,
  0x50000100, 0x00040100, 0x10030100, 0x00030100, 0x20020100, 0x01020100, 0x10020100, 0x00020100,
  0x30010100, 0x02010100, 0x11010100, 0x01010100, 0x20010100, 0x00010110, 0x10010100, 0x00010100,
  0x40000100, 0x03000100, 0x12000100, 0x02000100, 0x21000100, 0x01000110, 0x11000100, 0x01000100,
  0x30000100, 0x00000120, 0x10000110, 0x00000110, 0x20000100, 0x00001100, 0x10000100, 0x00000100,
  0x60000000, 0x00050000, 0x10040000, 0x00040000, 0x20030000, 0x01030000, 0x10030000, 0x00030000,
  0x30020000, 0x02020000, 0x11020000, 0x01020000, 0x20020000, 0x00020010, 0x10020000, 0x00020000,
  0x40010000, 0x03010000, 0x12010000, 0x02010000, 0x21010000, 0x01010010, 0x11010000, 0x01010000,
  0x30010000, 0x00010020, 0x10010010, 0x00010010, 0x20010000, 0x00011000, 0x10010000, 0x00010000,
  0x50000000, 0x04000000, 0x13000000, 0x03000000, 0x22000000, 0x02000010, 0x12000000, 0x02000000,
  0x31000000, 0x01000020, 0x11000010, 0x01000010, 0x21000000, 0x01001000, 0x11000000, 0x01000000,
  0x40000000, 0x00000030, 0x10000020, 0x00000020, 0x20000010, 0x00001010, 0x10000010, 0x00000010,
  0x30000000, 0x00002000, 0x10001000, 0x00001000, 0x20000000, 0x00100000, 0x10000000, 0x00000000,
]);

const kRiceCodeBits2Len = new Uint8Array([
  0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5,
  1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
  1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
  2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
  1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
  2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
  2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
  3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 4, 5, 5, 6, 5, 6, 6, 7, 5, 6, 6, 7, 6, 7, 7, 8,
]);

// br2: {p, p_end, bitpos}. dst: heap ptr (needs 8+ bytes slack past dst+size).
function DecodeGolombRiceLengths(dst, size, br2) {
  let p = br2.p;
  const p_end = br2.p_end;
  const dst_end = dst + size;
  if (p >= p_end) return false;

  let count = -br2.bitpos;
  let v = mem[p++] & (255 >>> br2.bitpos);
  for (;;) {
    if (v === 0) {
      count += 8;
    } else {
      const x = kRiceCodeBits2Value[v];
      wu32(dst, (count + (x & 0x0F0F0F0F)) >>> 0);
      wu32(dst + 4, (x >>> 4) & 0x0F0F0F0F);
      dst += kRiceCodeBits2Len[v];
      if (dst >= dst_end) break;
      count = x >>> 28;
    }
    if (p >= p_end) return false;
    v = mem[p++];
  }
  // went too far, step back
  if (dst > dst_end) {
    let n = dst - dst_end;
    do { v &= (v - 1); } while (--n);
  }
  // step back if byte not finished
  let bitpos = 0;
  if (!(v & 1)) {
    p--;
    bitpos = 8 - BSF(v);
  }
  br2.p = p;
  br2.bitpos = bitpos;
  return true;
}

function bswap64(x) {
  return (((x & 0xFFn) << 56n) | ((x & 0xFF00n) << 40n) | ((x & 0xFF0000n) << 24n) |
          ((x & 0xFF000000n) << 8n) | ((x >> 8n) & 0xFF000000n) | ((x >> 24n) & 0xFF0000n) |
          ((x >> 40n) & 0xFF00n) | ((x >> 56n) & 0xFFn));
}
const MASK64 = (1n << 64n) - 1n;

function DecodeGolombRiceBits(dst, size, bitcount, br2) {
  if (bitcount === 0) return true;
  const dst_end = dst + size;
  let p = br2.p;
  const bitpos = br2.bitpos;

  const bits_required = bitpos + bitcount * size;
  const bytes_required = (bits_required + 7) >> 3;
  if (bytes_required > br2.p_end - p) return false;

  br2.p = p + (bits_required >> 3);
  br2.bitpos = bits_required & 7;

  const bak = dv.getBigUint64(dst_end, true);

  if (bitcount < 2) {
    do {
      let bits = BigInt((u32be(p) >>> (24 - bitpos)) & 0xFF);
      p += 1;
      bits = (bits | (bits << 28n)) & 0xF0000000Fn;
      bits = (bits | (bits << 14n)) & 0x3000300030003n;
      bits = (bits | (bits << 7n)) & 0x0101010101010101n;
      dv.setBigUint64(dst, (dv.getBigUint64(dst, true) * 2n + bswap64(bits)) & MASK64, true);
      dst += 8;
    } while (dst < dst_end);
  } else if (bitcount === 2) {
    do {
      let bits = BigInt((u32be(p) >>> (16 - bitpos)) & 0xFFFF);
      p += 2;
      bits = (bits | (bits << 24n)) & 0xFF000000FFn;
      bits = (bits | (bits << 12n)) & 0xF000F000F000Fn;
      bits = (bits | (bits << 6n)) & 0x0303030303030303n;
      dv.setBigUint64(dst, (dv.getBigUint64(dst, true) * 4n + bswap64(bits)) & MASK64, true);
      dst += 8;
    } while (dst < dst_end);
  } else {
    do {
      let bits = BigInt((u32be(p) >>> (8 - bitpos)) & 0xFFFFFF);
      p += 3;
      bits = (bits | (bits << 20n)) & 0xFFF00000FFFn;
      bits = (bits | (bits << 10n)) & 0x3F003F003F003Fn;
      bits = (bits | (bits << 5n)) & 0x0707070707070707n;
      dv.setBigUint64(dst, (dv.getBigUint64(dst, true) * 8n + bswap64(bits)) & MASK64, true);
      dst += 8;
    } while (dst < dst_end);
  }
  dv.setBigUint64(dst_end, bak, true);
  return true;
}

// range: Int32Array pairs [symbol0, num0, symbol1, num1, ...]. symlen: heap ptr.
function Huff_ConvertToRanges(range, num_symbols, P, symlen, bits) {
  const num_ranges = P >> 1;
  let v, sym_idx = 0;

  // Start with space?
  if (P & 1) {
    BitReader_Refill(bits);
    v = mem[symlen++];
    if (v >= 8) return -1;
    sym_idx = BitReader_ReadBitsNoRefill(bits, v + 1) + ((1 << (v + 1)) >>> 0) - 1;
  }
  let syms_used = 0;

  for (let i = 0; i < num_ranges; i++) {
    BitReader_Refill(bits);
    v = mem[symlen];
    if (v >= 9) return -1;
    const num = BitReader_ReadBitsNoRefillZero(bits, v) + ((1 << v) >>> 0);
    v = mem[symlen + 1];
    if (v >= 8) return -1;
    const space = BitReader_ReadBitsNoRefill(bits, v + 1) + ((1 << (v + 1)) >>> 0) - 1;
    range[i * 2] = sym_idx;
    range[i * 2 + 1] = num;
    syms_used += num;
    sym_idx += num + space;
    symlen += 2;
  }

  if (sym_idx >= 256 || syms_used >= num_symbols || sym_idx + num_symbols - syms_used > 256)
    return -1;

  range[num_ranges * 2] = sym_idx;
  range[num_ranges * 2 + 1] = num_symbols - syms_used;

  return num_ranges + 1;
}

function Huff_ReadCodeLengthsNew(bits, syms, code_prefix) {
  const forced_bits = BitReader_ReadBitsNoRefill(bits, 2);

  const num_symbols = BitReader_ReadBitsNoRefill(bits, 8) + 1;

  const fluff = BitReader_ReadFluff(bits, num_symbols);

  const sp = stackPtr;
  try {
    const code_len = salloc(512 + 64); // slack: GolombRice writes past the end

    const br2 = {
      bitpos: (bits.bitpos - 24) & 7,
      p_end: bits.p_end,
      p: bits.p - ((24 - bits.bitpos + 7) >> 3),
    };

    if (!DecodeGolombRiceLengths(code_len, num_symbols + fluff, br2))
      return -1;
    memset(code_len + (num_symbols + fluff), 0, 16);
    if (!DecodeGolombRiceBits(code_len, num_symbols, forced_bits, br2))
      return -1;

    // Reset the bits decoder.
    bits.bitpos = 24;
    bits.p = br2.p;
    bits.bits = 0;
    BitReader_Refill(bits);
    bits.bits = (bits.bits << br2.bitpos) >>> 0;
    bits.bitpos += br2.bitpos;

    let running_sum = 0x1E;
    for (let i = 0; i < num_symbols; i++) {
      let v = mem[code_len + i];
      v = (-(v & 1) ^ (v >> 1)) | 0;
      const cl = (v + (running_sum >>> 2) + 1) | 0;
      if (cl < 1 || cl > 11) return -1;
      mem[code_len + i] = cl;
      running_sum = (running_sum + v) >>> 0;
    }

    const range = new Int32Array(258);
    const ranges = Huff_ConvertToRanges(range, num_symbols, fluff, code_len + num_symbols, bits);
    if (ranges <= 0) return -1;

    let cp = code_len;
    for (let i = 0; i < ranges; i++) {
      let sym = range[i * 2];
      let n = range[i * 2 + 1];
      do {
        mem[syms + code_prefix[mem[cp++]]++] = sym++;
      } while (--n);
    }

    return num_symbols;
  } finally {
    stackPtr = sp;
  }
}

// hufflut/rev_lut layout: bits2len at +0 (2048+16), bits2sym at +2064 (2048+16)
const HUFFLUT_SYM = 2064;
const HUFFLUT_SIZE = 4128;

function Huff_MakeLut(prefix_org, prefix_cur, hufflut, syms) {
  let currslot = 0;
  for (let i = 1; i < 11; i++) {
    const start = prefix_org[i];
    const count = prefix_cur[i] - start;
    if (count) {
      const stepsize = (1 << (11 - i)) >>> 0;
      const num_to_set = (count << (11 - i)) >>> 0;
      if (currslot + num_to_set > 2048) return false;
      memset(hufflut + currslot, i, num_to_set);

      let p = hufflut + HUFFLUT_SYM + currslot;
      for (let j = 0; j !== count; j++, p += stepsize)
        memset(p, mem[syms + start + j], stepsize);
      currslot += num_to_set;
    }
  }
  if (prefix_cur[11] - prefix_org[11] !== 0) {
    const num_to_set = prefix_cur[11] - prefix_org[11];
    if (currslot + num_to_set > 2048) return false;
    memset(hufflut + currslot, 11, num_to_set);
    memmove(hufflut + HUFFLUT_SYM + currslot, syms + prefix_org[11], num_to_set);
    currslot += num_to_set;
  }
  return currslot === 2048;
}

const code_prefix_org = new Uint32Array([0x0, 0x0, 0x2, 0x6, 0xE, 0x1E, 0x3E, 0x7E, 0xFE, 0x1FE, 0x2FE, 0x3FE]);

function Kraken_DecodeBytes_Type12(src, src_size, output, output_size, type) {
  let half_output_size;
  let split_left, split_mid, split_right;
  let src_mid;
  const src_end = src + src_size;

  const bits = { bitpos: 24, bits: 0, p: src, p_end: src_end };
  BitReader_Refill(bits);

  const code_prefix = Uint32Array.from(code_prefix_org);

  const sp = stackPtr;
  try {
    const syms = salloc(1280);
    let num_syms;
    if (!BitReader_ReadBitNoRefill(bits)) {
      num_syms = Huff_ReadCodeLengthsOld(bits, syms, code_prefix);
    } else if (!BitReader_ReadBitNoRefill(bits)) {
      num_syms = Huff_ReadCodeLengthsNew(bits, syms, code_prefix);
    } else {
      return -1;
    }

    if (num_syms < 1) return -1;
    src = bits.p - (((24 - bits.bitpos) / 8) | 0);

    if (num_syms === 1) {
      memset(output, mem[syms], output_size);
      return src - src_end; // (as in original ooz)
    }

    const huff_lut = salloc(HUFFLUT_SIZE);
    const rev_lut = salloc(HUFFLUT_SIZE);

    if (!Huff_MakeLut(code_prefix_org, code_prefix, huff_lut, syms))
      return -1;

    ReverseBitsArray2048(huff_lut, rev_lut);
    ReverseBitsArray2048(huff_lut + HUFFLUT_SYM, rev_lut + HUFFLUT_SYM);

    const hr = {};
    if (type === 1) {
      if (src + 3 > src_end) return -1;
      split_mid = u16(src);
      src += 2;
      hr.output = output;
      hr.output_end = output + output_size;
      hr.src = src;
      hr.src_end = src_end;
      hr.src_mid_org = hr.src_mid = src + split_mid;
      hr.src_bitpos = 0; hr.src_bits = 0;
      hr.src_mid_bitpos = 0; hr.src_mid_bits = 0;
      hr.src_end_bitpos = 0; hr.src_end_bits = 0;
      if (!Kraken_DecodeBytesCore(hr, rev_lut, rev_lut + HUFFLUT_SYM))
        return -1;
    } else {
      if (src + 6 > src_end) return -1;

      half_output_size = (output_size + 1) >> 1;
      split_mid = u32(src) & 0xFFFFFF;
      src += 3;
      if (split_mid > (src_end - src)) return -1;
      src_mid = src + split_mid;
      split_left = u16(src);
      src += 2;
      if (src_mid - src < split_left + 2 || src_end - src_mid < 3) return -1;
      split_right = u16(src_mid);
      if (src_end - (src_mid + 2) < split_right + 2) return -1;

      hr.output = output;
      hr.output_end = output + half_output_size;
      hr.src = src;
      hr.src_end = src_mid;
      hr.src_mid_org = hr.src_mid = src + split_left;
      hr.src_bitpos = 0; hr.src_bits = 0;
      hr.src_mid_bitpos = 0; hr.src_mid_bits = 0;
      hr.src_end_bitpos = 0; hr.src_end_bits = 0;
      if (!Kraken_DecodeBytesCore(hr, rev_lut, rev_lut + HUFFLUT_SYM))
        return -1;

      hr.output = output + half_output_size;
      hr.output_end = output + output_size;
      hr.src = src_mid + 2;
      hr.src_end = src_end;
      hr.src_mid_org = hr.src_mid = src_mid + 2 + split_right;
      hr.src_bitpos = 0; hr.src_bits = 0;
      hr.src_mid_bitpos = 0; hr.src_mid_bits = 0;
      hr.src_end_bitpos = 0; hr.src_end_bits = 0;
      if (!Kraken_DecodeBytesCore(hr, rev_lut, rev_lut + HUFFLUT_SYM))
        return -1;
    }
    return src_size;
  } finally {
    stackPtr = sp;
  }
}

const bitmasks = new Uint32Array([
  0x1, 0x3, 0x7, 0xF, 0x1F, 0x3F, 0x7F, 0xFF,
  0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF,
  0x1FFFF, 0x3FFFF, 0x7FFFF, 0xFFFFF, 0x1FFFFF, 0x3FFFFF, 0x7FFFFF,
  0xFFFFFF, 0x1FFFFFF, 0x3FFFFFF, 0x7FFFFFF, 0xFFFFFFF, 0x1FFFFFFF, 0x3FFFFFFF, 0x7FFFFFFF, 0xFFFFFFFF,
]);

// array_data/array_lens: Int32Array(array_count). out.total_size receives total.
// Returns bytes consumed or -1.
function Kraken_DecodeMultiArray(src, src_end, dst, dst_end,
                                 array_data, array_lens, array_count,
                                 out, force_memmove, scratch, scratch_end) {
  const src_org = src;

  if (src_end - src < 4) return -1;

  let num_arrays_in_file = mem[src++];
  if (!(num_arrays_in_file & 0x80)) return -1;
  num_arrays_in_file &= 0x3F;

  if (dst === scratch) {
    scratch += (scratch_end - scratch - 0xC000) >> 1;
    dst_end = scratch;
  }

  let total_size = 0;

  const ref = { output: 0, decodedSize: 0 };

  if (num_arrays_in_file === 0) {
    for (let i = 0; i < array_count; i++) {
      ref.output = dst;
      const dec = Kraken_DecodeBytes(ref, src, src_end, dst_end - dst, force_memmove, scratch, scratch_end);
      if (dec < 0) return -1;
      dst += ref.decodedSize;
      array_lens[i] = ref.decodedSize;
      array_data[i] = ref.output;
      src += dec;
      total_size += ref.decodedSize;
    }
    out.total_size = total_size;
    return src - src_org; // not supported yet (as in original)
  }

  const entropy_array_data = new Int32Array(32);
  const entropy_array_size = new Uint32Array(32);

  // First loop just decodes everything to scratch
  let scratch_cur = scratch;

  for (let i = 0; i < num_arrays_in_file; i++) {
    ref.output = scratch_cur;
    const dec = Kraken_DecodeBytes(ref, src, src_end, scratch_end - scratch_cur, force_memmove, scratch_cur, scratch_end);
    if (dec < 0) return -1;
    entropy_array_data[i] = ref.output;
    entropy_array_size[i] = ref.decodedSize;
    scratch_cur += ref.decodedSize;
    total_size += ref.decodedSize;
    src += dec;
  }
  out.total_size = total_size;

  if (src_end - src < 3) return -1;

  const Q = u16(src);
  src += 2;

  const bs = { dest_size: 0 };
  if (Kraken_GetBlockSize(src, src_end, bs, total_size) < 0) return -1;
  const num_indexes = bs.dest_size;

  let num_lens = num_indexes - array_count;
  if (num_lens < 1) return -1;

  if (scratch_end - scratch_cur < num_indexes) return -1;
  let interval_lenlog2 = scratch_cur;
  scratch_cur += num_indexes;

  if (scratch_end - scratch_cur < num_indexes) return -1;
  let interval_indexes = scratch_cur;
  scratch_cur += num_indexes;

  if (Q & 0x8000) {
    ref.output = interval_indexes;
    const n = Kraken_DecodeBytes(ref, src, src_end, num_indexes, false, scratch_cur, scratch_end);
    if (n < 0 || ref.decodedSize !== num_indexes) return -1;
    interval_indexes = ref.output;
    src += n;

    for (let i = 0; i < num_indexes; i++) {
      const t = mem[interval_indexes + i];
      mem[interval_lenlog2 + i] = t >> 4;
      mem[interval_indexes + i] = t & 0xF;
    }

    num_lens = num_indexes;
  } else {
    const lenlog2_chunksize = num_indexes - array_count;

    ref.output = interval_indexes;
    let n = Kraken_DecodeBytes(ref, src, src_end, num_indexes, false, scratch_cur, scratch_end);
    if (n < 0 || ref.decodedSize !== num_indexes) return -1;
    interval_indexes = ref.output;
    src += n;

    ref.output = interval_lenlog2;
    n = Kraken_DecodeBytes(ref, src, src_end, lenlog2_chunksize, false, scratch_cur, scratch_end);
    if (n < 0 || ref.decodedSize !== lenlog2_chunksize) return -1;
    interval_lenlog2 = ref.output;
    src += n;

    for (let i = 0; i < lenlog2_chunksize; i++)
      if (mem[interval_lenlog2 + i] > 16) return -1;
  }

  if (scratch_end - scratch_cur < 4) return -1;

  scratch_cur = (scratch_cur + 3) & ~3;
  if (scratch_end - scratch_cur < num_lens * 4) return -1;
  const decoded_intervals = scratch_cur; // uint32 array in heap

  const varbits_complen = Q & 0x3FFF;
  if (src_end - src < varbits_complen) return -1;

  let f = src;
  let bits_f = 0;
  let bitpos_f = 24;

  const src_end_actual = src + varbits_complen;

  let b = src_end_actual;
  let bits_b = 0;
  let bitpos_b = 24;

  let i;
  for (i = 0; i + 2 <= num_lens; i += 2) {
    bits_f = (bits_f | (u32be(f) >>> (24 - bitpos_f))) >>> 0;
    f += (bitpos_f + 7) >> 3;

    bits_b = (bits_b | (u32(b - 4) >>> (24 - bitpos_b))) >>> 0;
    b -= (bitpos_b + 7) >> 3;

    const numbits_f = mem[interval_lenlog2 + i + 0];
    const numbits_b = mem[interval_lenlog2 + i + 1];

    bits_f = rotl32((bits_f | 1) >>> 0, numbits_f);
    bitpos_f += numbits_f - 8 * ((bitpos_f + 7) >> 3);

    bits_b = rotl32((bits_b | 1) >>> 0, numbits_b);
    bitpos_b += numbits_b - 8 * ((bitpos_b + 7) >> 3);

    const value_f = bits_f & bitmasks[numbits_f];
    bits_f = (bits_f & ~bitmasks[numbits_f]) >>> 0;

    const value_b = bits_b & bitmasks[numbits_b];
    bits_b = (bits_b & ~bitmasks[numbits_b]) >>> 0;

    wu32(decoded_intervals + 4 * (i + 0), value_f);
    wu32(decoded_intervals + 4 * (i + 1), value_b);
  }

  // read final one since above loop reads 2
  if (i < num_lens) {
    bits_f = (bits_f | (u32be(f) >>> (24 - bitpos_f))) >>> 0;
    const numbits_f = mem[interval_lenlog2 + i];
    bits_f = rotl32((bits_f | 1) >>> 0, numbits_f);
    const value_f = bits_f & bitmasks[numbits_f];
    wu32(decoded_intervals + 4 * (i + 0), value_f);
  }

  if (mem[interval_indexes + num_indexes - 1]) return -1;

  let indi = 0, leni = 0, source;
  const increment_leni = (Q & 0x8000) !== 0 ? 1 : 0;

  for (let arri = 0; arri < array_count; arri++) {
    array_data[arri] = dst;
    if (indi >= num_indexes) return -1;

    while ((source = mem[interval_indexes + indi++]) !== 0) {
      if (source > num_arrays_in_file) return -1;
      if (leni >= num_lens) return -1;
      const cur_len = u32(decoded_intervals + 4 * leni); leni++;
      const bytes_left = entropy_array_size[source - 1];
      if (cur_len > bytes_left || cur_len > dst_end - dst) return -1;
      const blksrc = entropy_array_data[source - 1];
      entropy_array_size[source - 1] -= cur_len;
      entropy_array_data[source - 1] += cur_len;
      const dstx = dst;
      dst += cur_len;
      memmove(dstx, blksrc, cur_len);
    }
    leni += increment_leni;
    array_lens[arri] = dst - array_data[arri];
  }

  if (indi !== num_indexes || leni !== num_lens) return -1;

  for (let k = 0; k < num_arrays_in_file; k++) {
    if (entropy_array_size[k]) return -1;
  }
  return src_end_actual - src_org;
}

function Krak_DecodeRecursive(src, src_size, output, output_size, scratch, scratch_end) {
  const src_org = src;
  const output_end = output + output_size;
  const src_end = src + src_size;

  if (src_size < 6) return -1;

  let n = mem[src] & 0x7F;
  if (n < 2) return -1;

  if (!(mem[src] & 0x80)) {
    src++;
    const ref = { output: 0, decodedSize: 0 };
    do {
      ref.output = output;
      const dec = Kraken_DecodeBytes(ref, src, src_end, output_end - output, true, scratch, scratch_end);
      if (dec < 0) return -1;
      output += ref.decodedSize;
      src += dec;
    } while (--n);
    if (output !== output_end) return -1;
    return src - src_org;
  } else {
    const array_data = new Int32Array(1);
    const array_lens = new Int32Array(1);
    const out = { total_size: 0 };
    const dec = Kraken_DecodeMultiArray(src, src_end, output, output_end, array_data, array_lens, 1, out, true, scratch, scratch_end);
    if (dec < 0) return -1;
    output += out.total_size;
    if (output !== output_end) return -1;
    return dec;
  }
}

function Krak_DecodeRLE(src, src_size, dst, dst_size, scratch, scratch_end) {
  if (src_size <= 1) {
    if (src_size !== 1) return -1;
    memset(dst, mem[src], dst_size);
    return 1;
  }
  const dst_end = dst + dst_size;
  let cmd_ptr = src + 1, cmd_ptr_end = src + src_size;
  // Unpack the first X bytes of the command buffer?
  if (mem[src]) {
    const ref = { output: scratch, decodedSize: 0 };
    const n = Kraken_DecodeBytes(ref, src, src + src_size, scratch_end - scratch, true, scratch, scratch_end);
    if (n <= 0) return -1;
    const dec_size = ref.decodedSize;
    const cmd_len = src_size - n + dec_size;
    if (cmd_len > scratch_end - scratch) return -1;
    memmove(ref.output + dec_size, src + n, src_size - n);
    cmd_ptr = ref.output;
    cmd_ptr_end = ref.output + cmd_len;
  }

  let rle_byte = 0;

  while (cmd_ptr < cmd_ptr_end) {
    const cmd = mem[cmd_ptr_end - 1];
    if (((cmd - 1) >>> 0) >= 0x2F) {
      cmd_ptr_end--;
      const bytes_to_copy = (~cmd) & 0xF;
      const bytes_to_rle = cmd >> 4;
      if (dst_end - dst < bytes_to_copy + bytes_to_rle || cmd_ptr_end - cmd_ptr < bytes_to_copy)
        return -1;
      memmove(dst, cmd_ptr, bytes_to_copy);
      cmd_ptr += bytes_to_copy;
      dst += bytes_to_copy;
      memset(dst, rle_byte, bytes_to_rle);
      dst += bytes_to_rle;
    } else if (cmd >= 0x10) {
      const data = (u16(cmd_ptr_end - 2) - 4096) >>> 0;
      cmd_ptr_end -= 2;
      const bytes_to_copy = data & 0x3F;
      const bytes_to_rle = data >>> 6;
      if (dst_end - dst < bytes_to_copy + bytes_to_rle || cmd_ptr_end - cmd_ptr < bytes_to_copy)
        return -1;
      memmove(dst, cmd_ptr, bytes_to_copy);
      cmd_ptr += bytes_to_copy;
      dst += bytes_to_copy;
      memset(dst, rle_byte, bytes_to_rle);
      dst += bytes_to_rle;
    } else if (cmd === 1) {
      rle_byte = mem[cmd_ptr++];
      cmd_ptr_end--;
    } else if (cmd >= 9) {
      const bytes_to_rle = ((u16(cmd_ptr_end - 2) - 0x8FF) >>> 0) * 128;
      cmd_ptr_end -= 2;
      if (dst_end - dst < bytes_to_rle) return -1;
      memset(dst, rle_byte, bytes_to_rle);
      dst += bytes_to_rle;
    } else {
      const bytes_to_copy = ((u16(cmd_ptr_end - 2) - 511) >>> 0) * 64;
      cmd_ptr_end -= 2;
      if (cmd_ptr_end - cmd_ptr < bytes_to_copy || dst_end - dst < bytes_to_copy)
        return -1;
      memmove(dst, cmd_ptr, bytes_to_copy);
      dst += bytes_to_copy;
      cmd_ptr += bytes_to_copy;
    }
  }
  if (cmd_ptr_end !== cmd_ptr) return -1;

  if (dst !== dst_end) return -1;

  return src_size;
}

// ---- TANS -----------------------------------------------------------------------
// tans_data: {A_used, B_used, A: Uint8Array(256), B: Uint32Array(256)}

function Tans_DecodeTable(bits, L_bits, tans_data) {
  BitReader_Refill(bits);
  if (BitReader_ReadBitNoRefill(bits)) {
    const Q = BitReader_ReadBitsNoRefill(bits, 3);
    const num_symbols = BitReader_ReadBitsNoRefill(bits, 8) + 1;
    if (num_symbols < 2) return false;
    let fluff = BitReader_ReadFluff(bits, num_symbols);
    const total_rice_values = fluff + num_symbols;

    const sp = stackPtr;
    try {
      const rice = salloc(512 + 16 + 16);

      // another bit reader...
      const br2 = {
        p: bits.p - ((24 - bits.bitpos + 7) >> 3),
        p_end: bits.p_end,
        bitpos: (bits.bitpos - 24) & 7,
      };

      if (!DecodeGolombRiceLengths(rice, total_rice_values, br2))
        return false;
      memset(rice + total_rice_values, 0, 16);

      // Switch back to other bitreader impl
      bits.bitpos = 24;
      bits.p = br2.p;
      bits.bits = 0;
      BitReader_Refill(bits);
      bits.bits = (bits.bits << br2.bitpos) >>> 0;
      bits.bitpos += br2.bitpos;

      const range = new Int32Array(266);
      fluff = Huff_ConvertToRanges(range, num_symbols, fluff, rice + num_symbols, bits);
      if (fluff < 0) return false;

      BitReader_Refill(bits);

      const L = (1 << L_bits) >>> 0;
      let cur_rice_ptr = rice;
      let average = 6;
      let somesum = 0;
      const A = tans_data.A, B = tans_data.B;
      let ai = 0, bi = 0;

      for (let ri = 0; ri < fluff; ri++) {
        let symbol = range[ri * 2];
        let num = range[ri * 2 + 1];
        do {
          BitReader_Refill(bits);

          const nextra = Q + mem[cur_rice_ptr++];
          if (nextra > 15) return false;
          let v = BitReader_ReadBitsNoRefillZero(bits, nextra) + ((1 << nextra) >>> 0) - ((1 << Q) >>> 0);

          const average_div4 = average >> 2;
          let limit = 2 * average_div4;
          if (v <= limit)
            v = average_div4 + ((-(v & 1)) ^ (v >>> 1));
          if (limit > v)
            limit = v;
          v += 1;
          average += limit - average_div4;
          A[ai] = symbol;
          B[bi] = ((symbol << 16) + v) >>> 0;
          ai += (v === 1) ? 1 : 0;
          bi += (v >= 2) ? 1 : 0;
          somesum += v;
          symbol += 1;
        } while (--num);
      }
      tans_data.A_used = ai;
      tans_data.B_used = bi;
      if (somesum !== L) return false;

      return true;
    } finally {
      stackPtr = sp;
    }
  } else {
    const seen = new Uint8Array(256);
    const L = (1 << L_bits) >>> 0;

    let count = BitReader_ReadBitsNoRefill(bits, 3) + 1;

    const bits_per_sym = BSR(L_bits) + 1;
    const max_delta_bits = BitReader_ReadBitsNoRefill(bits, bits_per_sym);

    if (max_delta_bits === 0 || max_delta_bits > L_bits) return false;

    const A = tans_data.A, B = tans_data.B;
    let ai = 0, bi = 0;

    let weight = 0;
    let total_weights = 0;

    do {
      BitReader_Refill(bits);

      const sym = BitReader_ReadBitsNoRefill(bits, 8);
      if (seen[sym]) return false;

      const delta = BitReader_ReadBitsNoRefill(bits, max_delta_bits);

      weight += delta;

      if (weight === 0) return false;

      seen[sym] = 1;
      if (weight === 1) {
        A[ai++] = sym;
      } else {
        B[bi++] = ((sym << 16) + weight) >>> 0;
      }

      total_weights += weight;
    } while (--count);

    BitReader_Refill(bits);

    const sym = BitReader_ReadBitsNoRefill(bits, 8);
    if (seen[sym]) return false;

    if (L - total_weights < weight || L - total_weights <= 1) return false;

    B[bi++] = ((sym << 16) + (L - total_weights)) >>> 0;

    tans_data.A_used = ai;
    tans_data.B_used = bi;

    tans_data.A.subarray(0, ai).sort();
    tans_data.B.subarray(0, bi).sort();
    return true;
  }
}

// TansLutEnt: 8 bytes in heap: u32 x @0, u8 bits_x @4, u8 symbol @5, u16 w @6.

function Tans_InitLut(tans_data, L_bits, lut) {
  const pointers = new Int32Array(4); // heap ptrs

  const L = 1 << L_bits;
  const a_used = tans_data.A_used;

  const slots_left_to_alloc = L - a_used;

  const sa = slots_left_to_alloc >>> 2;
  pointers[0] = lut;
  let sb = sa + ((slots_left_to_alloc & 3) > 0 ? 1 : 0);
  pointers[1] = lut + sb * 8;
  sb += sa + ((slots_left_to_alloc & 3) > 1 ? 1 : 0);
  pointers[2] = lut + sb * 8;
  sb += sa + ((slots_left_to_alloc & 3) > 2 ? 1 : 0);
  pointers[3] = lut + sb * 8;

  // Setup the single entrys with weight=1
  {
    const lut_singles = lut + slots_left_to_alloc * 8;
    const le_x = ((1 << L_bits) - 1) >>> 0;
    for (let i = 0; i < a_used; i++) {
      const p = lut_singles + i * 8;
      wu32(p, le_x);
      mem[p + 4] = L_bits;
      mem[p + 5] = tans_data.A[i];
      wu16(p + 6, 0);
    }
  }

  // Setup the entrys with weight >= 2
  let weights_sum = 0;
  for (let i = 0; i < tans_data.B_used; i++) {
    const weight = tans_data.B[i] & 0xFFFF;
    const symbol = tans_data.B[i] >>> 16;
    if (weight > 4) {
      const sym_bits = BSR(weight);
      let Z = L_bits - sym_bits;
      const le = { symbol: symbol, bits_x: Z, x: ((1 << Z) - 1) >>> 0, w: (L - 1) & ((weight << Z) >>> 0) };
      let what_to_add = (1 << Z) >>> 0;
      let X = ((1 << (sym_bits + 1)) >>> 0) - weight;

      for (let j = 0; j < 4; j++) {
        let dst = pointers[j];

        const Y = (weight + ((weights_sum - j - 1) & 3)) >> 2;
        if (X >= Y) {
          for (let n = Y; n; n--) {
            wu32(dst, le.x); mem[dst + 4] = le.bits_x; mem[dst + 5] = le.symbol; wu16(dst + 6, le.w);
            dst += 8;
            le.w = (le.w + what_to_add) & 0xFFFF;
          }
          X -= Y;
        } else {
          for (let n = X; n; n--) {
            wu32(dst, le.x); mem[dst + 4] = le.bits_x; mem[dst + 5] = le.symbol; wu16(dst + 6, le.w);
            dst += 8;
            le.w = (le.w + what_to_add) & 0xFFFF;
          }
          Z--;

          what_to_add >>= 1;
          le.bits_x = Z;
          le.w = 0;
          le.x = le.x >>> 1;
          for (let n = Y - X; n; n--) {
            wu32(dst, le.x); mem[dst + 4] = le.bits_x; mem[dst + 5] = le.symbol; wu16(dst + 6, le.w);
            dst += 8;
            le.w = (le.w + what_to_add) & 0xFFFF;
          }
          X = weight;
        }
        pointers[j] = dst;
      }
    } else {
      let bits = (((1 << weight) - 1) << (weights_sum & 3)) >>> 0;
      bits |= (bits >>> 4);
      let n = weight, ww = weight;
      do {
        const idx = BSF(bits);
        bits &= bits - 1;
        const dst = pointers[idx];
        pointers[idx] += 8;
        const weight_bits = BSR(ww);
        mem[dst + 5] = symbol;
        mem[dst + 4] = L_bits - weight_bits;
        wu32(dst, ((1 << (L_bits - weight_bits)) - 1) >>> 0);
        wu16(dst + 6, (L - 1) & ((ww++ << (L_bits - weight_bits)) >>> 0));
      } while (--n);
    }
    weights_sum += weight;
  }
}

function Tans_Decode(params) {
  const lut = params.lut;
  let dst = params.dst;
  const dst_end = params.dst_end;
  let ptr_f = params.ptr_f, ptr_b = params.ptr_b;
  let bits_f = params.bits_f >>> 0, bits_b = params.bits_b >>> 0;
  let bitpos_f = params.bitpos_f, bitpos_b = params.bitpos_b;
  let state_0 = params.state_0, state_1 = params.state_1;
  let state_2 = params.state_2, state_3 = params.state_3;
  let state_4 = params.state_4;
  let e;

  if (ptr_f > ptr_b) return false;

  if (dst < dst_end) {
    outer:
    for (;;) {
      // TANS_FORWARD_BITS
      bits_f = (bits_f | (u32(ptr_f) << bitpos_f)) >>> 0;
      ptr_f += (31 - bitpos_f) >> 3;
      bitpos_f |= 24;

      // TANS_FORWARD_ROUND(state_0)
      e = lut + state_0 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_f -= mem[e + 4];
      state_0 = ((bits_f & u32(e)) + u16(e + 6)) >>> 0;
      bits_f = bits_f >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      // TANS_FORWARD_ROUND(state_1)
      e = lut + state_1 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_f -= mem[e + 4];
      state_1 = ((bits_f & u32(e)) + u16(e + 6)) >>> 0;
      bits_f = bits_f >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      bits_f = (bits_f | (u32(ptr_f) << bitpos_f)) >>> 0;
      ptr_f += (31 - bitpos_f) >> 3;
      bitpos_f |= 24;

      e = lut + state_2 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_f -= mem[e + 4];
      state_2 = ((bits_f & u32(e)) + u16(e + 6)) >>> 0;
      bits_f = bits_f >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      e = lut + state_3 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_f -= mem[e + 4];
      state_3 = ((bits_f & u32(e)) + u16(e + 6)) >>> 0;
      bits_f = bits_f >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      bits_f = (bits_f | (u32(ptr_f) << bitpos_f)) >>> 0;
      ptr_f += (31 - bitpos_f) >> 3;
      bitpos_f |= 24;

      e = lut + state_4 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_f -= mem[e + 4];
      state_4 = ((bits_f & u32(e)) + u16(e + 6)) >>> 0;
      bits_f = bits_f >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      // TANS_BACKWARD_BITS
      bits_b = (bits_b | (u32be(ptr_b - 4) << bitpos_b)) >>> 0;
      ptr_b -= (31 - bitpos_b) >> 3;
      bitpos_b |= 24;

      e = lut + state_0 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_b -= mem[e + 4];
      state_0 = ((bits_b & u32(e)) + u16(e + 6)) >>> 0;
      bits_b = bits_b >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      e = lut + state_1 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_b -= mem[e + 4];
      state_1 = ((bits_b & u32(e)) + u16(e + 6)) >>> 0;
      bits_b = bits_b >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      bits_b = (bits_b | (u32be(ptr_b - 4) << bitpos_b)) >>> 0;
      ptr_b -= (31 - bitpos_b) >> 3;
      bitpos_b |= 24;

      e = lut + state_2 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_b -= mem[e + 4];
      state_2 = ((bits_b & u32(e)) + u16(e + 6)) >>> 0;
      bits_b = bits_b >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      e = lut + state_3 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_b -= mem[e + 4];
      state_3 = ((bits_b & u32(e)) + u16(e + 6)) >>> 0;
      bits_b = bits_b >>> mem[e + 4];
      if (dst >= dst_end) break outer;

      bits_b = (bits_b | (u32be(ptr_b - 4) << bitpos_b)) >>> 0;
      ptr_b -= (31 - bitpos_b) >> 3;
      bitpos_b |= 24;

      e = lut + state_4 * 8;
      mem[dst++] = mem[e + 5];
      bitpos_b -= mem[e + 4];
      state_4 = ((bits_b & u32(e)) + u16(e + 6)) >>> 0;
      bits_b = bits_b >>> mem[e + 4];
      if (dst >= dst_end) break outer;
    }
  }

  if (ptr_b - ptr_f + (bitpos_f >> 3) + (bitpos_b >> 3) !== 0)
    return false;

  const states_or = (state_0 | state_1 | state_2 | state_3 | state_4) >>> 0;
  if (states_or & ~0xFF) return false;

  mem[dst_end] = state_0;
  mem[dst_end + 1] = state_1;
  mem[dst_end + 2] = state_2;
  mem[dst_end + 3] = state_3;
  mem[dst_end + 4] = state_4;
  return true;
}

function Krak_DecodeTans(src, src_size, dst, dst_size, scratch, scratch_end) {
  if (src_size < 8 || dst_size < 5) return -1;

  let src_end = src + src_size;

  const br = { bitpos: 24, bits: 0, p: src, p_end: src_end };
  BitReader_Refill(br);

  // reserved bit
  if (BitReader_ReadBitNoRefill(br)) return -1;

  const L_bits = BitReader_ReadBitsNoRefill(br, 2) + 8;

  const tans_data = { A_used: 0, B_used: 0, A: new Uint8Array(256), B: new Uint32Array(256) };
  if (!Tans_DecodeTable(br, L_bits, tans_data)) return -1;

  src = br.p - (((24 - br.bitpos) / 8) | 0);

  if (src >= src_end) return -1;

  const lut_space_required = ((8 << L_bits) + 15) & ~15;
  if (lut_space_required > (scratch_end - scratch)) return -1;

  const params = {};
  params.dst = dst;
  params.dst_end = dst + dst_size - 5;

  params.lut = (scratch + 15) & ~15;
  Tans_InitLut(tans_data, L_bits, params.lut);

  // Read out the initial state
  const L_mask = ((1 << L_bits) - 1) >>> 0;
  let bits_f = u32(src);
  src += 4;
  let bits_b = u32be(src_end - 4);
  src_end -= 4;
  let bitpos_f = 32, bitpos_b = 32;

  // Read first two.
  params.state_0 = (bits_f & L_mask) >>> 0;
  params.state_1 = (bits_b & L_mask) >>> 0;
  bits_f = bits_f >>> L_bits; bitpos_f -= L_bits;
  bits_b = bits_b >>> L_bits; bitpos_b -= L_bits;

  // Read next two.
  params.state_2 = (bits_f & L_mask) >>> 0;
  params.state_3 = (bits_b & L_mask) >>> 0;
  bits_f = bits_f >>> L_bits; bitpos_f -= L_bits;
  bits_b = bits_b >>> L_bits; bitpos_b -= L_bits;

  // Refill more bits
  bits_f = (bits_f | (u32(src) << bitpos_f)) >>> 0;
  src += (31 - bitpos_f) >> 3;
  bitpos_f |= 24;

  // Read final state variable
  params.state_4 = (bits_f & L_mask) >>> 0;
  bits_f = bits_f >>> L_bits; bitpos_f -= L_bits;

  params.bits_f = bits_f;
  params.ptr_f = src - (bitpos_f >> 3);
  params.bitpos_f = bitpos_f & 7;

  params.bits_b = bits_b;
  params.ptr_b = src_end + (bitpos_b >> 3);
  params.bitpos_b = bitpos_b & 7;

  if (!Tans_Decode(params)) return -1;

  return src_size;
}

// out: {dest_size}. Returns src bytes consumed (or src_size for compressed) or -1.
function Kraken_GetBlockSize(src, src_end, out, dest_capacity) {
  const src_org = src;
  let src_size, dst_size;

  if (src_end - src < 2) return -1; // too few bytes

  const chunk_type = (mem[src] >> 4) & 0x7;
  if (chunk_type === 0) {
    if (mem[src] >= 0x80) {
      // In this mode, memcopy stores the length in the bottom 12 bits.
      src_size = ((mem[src] << 8) | mem[src + 1]) & 0xFFF;
      src += 2;
    } else {
      if (src_end - src < 3) return -1; // too few bytes
      src_size = (mem[src] << 16) | (mem[src + 1] << 8) | mem[src + 2];
      if (src_size & ~0x3FFFF) return -1; // reserved bits must not be set
      src += 3;
    }
    if (src_size > dest_capacity || src_end - src < src_size) return -1;
    out.dest_size = src_size;
    return src + src_size - src_org;
  }

  if (chunk_type >= 6) return -1;

  // In all the other modes, the initial bytes encode the src_size and the dst_size
  if (mem[src] >= 0x80) {
    if (src_end - src < 3) return -1; // too few bytes

    // short mode, 10 bit sizes
    const bits = (mem[src] << 16) | (mem[src + 1] << 8) | mem[src + 2];
    src_size = bits & 0x3FF;
    dst_size = src_size + ((bits >> 10) & 0x3FF) + 1;
    src += 3;
  } else {
    // long mode, 18 bit sizes
    if (src_end - src < 5) return -1; // too few bytes
    const bits = ((mem[src + 1] << 24) | (mem[src + 2] << 16) | (mem[src + 3] << 8) | mem[src + 4]) >>> 0;
    src_size = bits & 0x3FFFF;
    dst_size = (((bits >>> 18) | (mem[src] << 14)) & 0x3FFFF) + 1;
    if (src_size >= dst_size) return -1;
    src += 5;
  }
  if (src_end - src < src_size || dst_size > dest_capacity) return -1;
  out.dest_size = dst_size;
  return src_size;
}

// ref: {output (in/out), decodedSize (out)}. Returns bytes consumed or -1.
function Kraken_DecodeBytes(ref, src, src_end, output_size, force_memmove, scratch, scratch_end) {
  const src_org = src;
  let src_size, dst_size;

  if (src_end - src < 2) return -1; // too few bytes

  const chunk_type = (mem[src] >> 4) & 0x7;
  if (chunk_type === 0) {
    if (mem[src] >= 0x80) {
      // In this mode, memcopy stores the length in the bottom 12 bits.
      src_size = ((mem[src] << 8) | mem[src + 1]) & 0xFFF;
      src += 2;
    } else {
      if (src_end - src < 3) return -1; // too few bytes
      src_size = (mem[src] << 16) | (mem[src + 1] << 8) | mem[src + 2];
      if (src_size & ~0x3FFFF) return -1; // reserved bits must not be set
      src += 3;
    }
    if (src_size > output_size || src_end - src < src_size) return -1;
    ref.decodedSize = src_size;
    if (force_memmove)
      memmove(ref.output, src, src_size);
    else
      ref.output = src;
    return src + src_size - src_org;
  }

  // In all the other modes, the initial bytes encode the src_size and the dst_size
  if (mem[src] >= 0x80) {
    if (src_end - src < 3) return -1; // too few bytes

    // short mode, 10 bit sizes
    const bits = (mem[src] << 16) | (mem[src + 1] << 8) | mem[src + 2];
    src_size = bits & 0x3FF;
    dst_size = src_size + ((bits >> 10) & 0x3FF) + 1;
    src += 3;
  } else {
    // long mode, 18 bit sizes
    if (src_end - src < 5) return -1; // too few bytes
    const bits = ((mem[src + 1] << 24) | (mem[src + 2] << 16) | (mem[src + 3] << 8) | mem[src + 4]) >>> 0;
    src_size = bits & 0x3FFFF;
    dst_size = (((bits >>> 18) | (mem[src] << 14)) & 0x3FFFF) + 1;
    if (src_size >= dst_size) return -1;
    src += 5;
  }
  if (src_end - src < src_size || dst_size > output_size) return -1;

  const dst = ref.output;
  if (dst === scratch) {
    if (scratch_end - scratch < dst_size) return -1;
    scratch += dst_size;
  }

  let src_used = -1;
  switch (chunk_type) {
    case 2:
    case 4:
      src_used = Kraken_DecodeBytes_Type12(src, src_size, dst, dst_size, chunk_type >> 1);
      break;
    case 5:
      src_used = Krak_DecodeRecursive(src, src_size, dst, dst_size, scratch, scratch_end);
      break;
    case 3:
      src_used = Krak_DecodeRLE(src, src_size, dst, dst_size, scratch, scratch_end);
      break;
    case 1:
      src_used = Krak_DecodeTans(src, src_size, dst, dst_size, scratch, scratch_end);
      break;
  }
  if (src_used !== src_size) return -1;
  ref.decodedSize = dst_size;
  return src + src_size - src_org;
}

// offs_stream: heap ptr to int32 array. low_bits: heap ptr to u8 array.
function CombineScaledOffsetArrays(offs_stream, offs_stream_size, scale, low_bits) {
  for (let i = 0; i !== offs_stream_size; i++)
    wi32(offs_stream + 4 * i, (Math.imul(scale, i32(offs_stream + 4 * i)) - mem[low_bits + i]) | 0);
}

// Unpacks the packed 8 bit offset and lengths into 32 bit.
// offs_stream/len_stream: heap ptrs to int32 arrays.
function Kraken_UnpackOffsets(src, src_end,
                              packed_offs_stream, packed_offs_stream_extra, packed_offs_stream_size,
                              multi_dist_scale,
                              packed_litlen_stream, packed_litlen_stream_size,
                              offs_stream, len_stream,
                              excess_flag, excess_bytes) {
  let n, i;
  let u32_len_stream_size = 0;

  const bits_a = { bitpos: 24, bits: 0, p: src, p_end: src_end };
  BitReader_Refill(bits_a);

  const bits_b = { bitpos: 24, bits: 0, p: src_end, p_end: src };
  BitReader_RefillBackwards(bits_b);

  if (!excess_flag) {
    if (bits_b.bits < 0x2000) return false;
    n = 31 - BSR(bits_b.bits);
    bits_b.bitpos += n;
    bits_b.bits = (bits_b.bits << n) >>> 0;
    BitReader_RefillBackwards(bits_b);
    n++;
    u32_len_stream_size = ((bits_b.bits >>> (32 - n)) - 1) >>> 0;
    bits_b.bitpos += n;
    bits_b.bits = (bits_b.bits << n) >>> 0;
    BitReader_RefillBackwards(bits_b);
  }

  let osp = offs_stream;
  if (multi_dist_scale === 0) {
    // Traditional way of coding offsets
    let pos = packed_offs_stream;
    const pos_end = packed_offs_stream + packed_offs_stream_size;
    while (pos !== pos_end) {
      wi32(osp, -BitReader_ReadDistance(bits_a, mem[pos++]) | 0); osp += 4;
      if (pos === pos_end) break;
      wi32(osp, -BitReader_ReadDistanceB(bits_b, mem[pos++]) | 0); osp += 4;
    }
  } else {
    // New way of coding offsets
    const offs_stream_org = osp;
    let pos = packed_offs_stream;
    const pos_end = packed_offs_stream + packed_offs_stream_size;
    let cmd, offs;
    while (pos !== pos_end) {
      cmd = mem[pos++];
      if ((cmd >> 3) > 26) return 0;
      offs = (((8 + (cmd & 7)) << (cmd >> 3)) | BitReader_ReadMoreThan24Bits(bits_a, cmd >> 3)) >>> 0;
      wi32(osp, (8 - offs) | 0); osp += 4;
      if (pos === pos_end) break;
      cmd = mem[pos++];
      if ((cmd >> 3) > 26) return 0;
      offs = (((8 + (cmd & 7)) << (cmd >> 3)) | BitReader_ReadMoreThan24BitsB(bits_b, cmd >> 3)) >>> 0;
      wi32(osp, (8 - offs) | 0); osp += 4;
    }
    if (multi_dist_scale !== 1) {
      CombineScaledOffsetArrays(offs_stream_org, (osp - offs_stream_org) >> 2, multi_dist_scale, packed_offs_stream_extra);
    }
  }
  const u32_len_stream_buf = new Uint32Array(512); // max count is 128kb / 256 = 512
  if (u32_len_stream_size > 512) return false;

  let uls = 0;
  for (i = 0; i + 1 < u32_len_stream_size; i += 2) {
    let r = BitReader_ReadLength(bits_a);
    if (r < 0) return false;
    u32_len_stream_buf[i + 0] = r;
    r = BitReader_ReadLengthB(bits_b);
    if (r < 0) return false;
    u32_len_stream_buf[i + 1] = r;
  }
  if (i < u32_len_stream_size) {
    const r = BitReader_ReadLength(bits_a);
    if (r < 0) return false;
    u32_len_stream_buf[i + 0] = r;
  }

  bits_a.p -= (24 - bits_a.bitpos) >> 3;
  bits_b.p += (24 - bits_b.bitpos) >> 3;

  if (bits_a.p !== bits_b.p) return false;

  for (i = 0; i < packed_litlen_stream_size; i++) {
    let v = mem[packed_litlen_stream + i];
    if (v === 255)
      v = u32_len_stream_buf[uls++] + 255;
    wi32(len_stream + 4 * i, v + 3);
  }
  if (uls !== u32_len_stream_size) return false;

  return true;
}

// ---- Kraken LZ ---------------------------------------------------------------

// Emulates C's `(uintptr_t)a < (uintptr_t)b` where a/b are small signed ints
// (sign-extended to 64-bit unsigned before comparing).
function ultSigned(a, b) {
  if ((a < 0) === (b < 0)) return a < b;
  return a >= 0;
}

// lztable: JS object {cmd_stream, cmd_stream_size, offs_stream, offs_stream_size,
//                     lit_stream, lit_stream_size, len_stream, len_stream_size}
function Kraken_ReadLzTable(mode, src, src_end, dst, dst_size, offset, scratch, scratch_end, lztable) {
  let n;

  if (mode > 1) return false;

  if (src_end - src < 13) return false;

  if (offset === 0) {
    copy64(dst, src);
    dst += 8;
    src += 8;
  }

  if (mem[src] & 0x80) {
    const flag = mem[src++];
    if ((flag & 0xC0) !== 0x80) return false; // reserved flag set
    return false; // excess bytes not supported
  }

  // Disable no copy optimization if source and dest overlap
  const force_copy = (dst <= src_end && src <= dst + dst_size) ? true : false;

  const ref = { output: 0, decodedSize: 0 };

  // Decode lit stream, bounded by dst_size
  ref.output = scratch;
  n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size), force_copy, scratch, scratch_end);
  if (n < 0) return false;
  src += n;
  lztable.lit_stream = ref.output;
  lztable.lit_stream_size = ref.decodedSize;
  scratch += ref.decodedSize;

  // Decode command stream, bounded by dst_size
  ref.output = scratch;
  n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size), force_copy, scratch, scratch_end);
  if (n < 0) return false;
  src += n;
  lztable.cmd_stream = ref.output;
  lztable.cmd_stream_size = ref.decodedSize;
  scratch += ref.decodedSize;

  // Check if to decode the multistuff crap
  if (src_end - src < 3) return false;

  let offs_scaling = 0;
  let packed_offs_stream_extra = 0;
  let packed_offs_stream, packed_len_stream;

  if (mem[src] & 0x80) {
    // uses the mode where distances are coded with 2 tables
    offs_scaling = mem[src] - 127;
    src++;

    ref.output = scratch;
    n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, lztable.cmd_stream_size), false, scratch, scratch_end);
    if (n < 0) return false;
    packed_offs_stream = ref.output;
    lztable.offs_stream_size = ref.decodedSize;
    src += n;
    scratch += lztable.offs_stream_size;

    if (offs_scaling !== 1) {
      ref.output = scratch;
      n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, lztable.offs_stream_size), false, scratch, scratch_end);
      if (n < 0 || ref.decodedSize !== lztable.offs_stream_size) return false;
      packed_offs_stream_extra = ref.output;
      src += n;
      scratch += ref.decodedSize;
    }
  } else {
    // Decode packed offset stream, it's bounded by the command length.
    ref.output = scratch;
    n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, lztable.cmd_stream_size), false, scratch, scratch_end);
    if (n < 0) return false;
    packed_offs_stream = ref.output;
    lztable.offs_stream_size = ref.decodedSize;
    src += n;
    scratch += lztable.offs_stream_size;
  }

  // Decode packed litlen stream. It's bounded by 1/4 of dst_size.
  ref.output = scratch;
  n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size >> 2), false, scratch, scratch_end);
  if (n < 0) return false;
  packed_len_stream = ref.output;
  lztable.len_stream_size = ref.decodedSize;
  src += n;
  scratch += lztable.len_stream_size;

  // Reserve memory for final dist stream
  scratch = (scratch + 15) & ~15;
  lztable.offs_stream = scratch;
  scratch += lztable.offs_stream_size * 4;

  // Reserve memory for final len stream
  scratch = (scratch + 15) & ~15;
  lztable.len_stream = scratch;
  scratch += lztable.len_stream_size * 4;

  if (scratch + 64 > scratch_end) return false;

  return Kraken_UnpackOffsets(src, src_end, packed_offs_stream, packed_offs_stream_extra,
                              lztable.offs_stream_size, offs_scaling,
                              packed_len_stream, lztable.len_stream_size,
                              lztable.offs_stream, lztable.len_stream, false, 0);
}

// Note: may access memory out of bounds on invalid input.
function Kraken_ProcessLzRuns_Type0(lzt, dst, dst_end, dst_start) {
  let cmd_stream = lzt.cmd_stream;
  const cmd_stream_end = cmd_stream + lzt.cmd_stream_size;
  let len_stream = lzt.len_stream;
  const len_stream_end = lzt.len_stream + 4 * lzt.len_stream_size;
  let lit_stream = lzt.lit_stream;
  const lit_stream_end = lzt.lit_stream + lzt.lit_stream_size;
  let offs_stream = lzt.offs_stream;
  const offs_stream_end = lzt.offs_stream + 4 * lzt.offs_stream_size;
  let copyfrom;
  let final_len;
  let offset;
  const recent_offs = new Int32Array(7);
  let last_offset;

  recent_offs[3] = -8;
  recent_offs[4] = -8;
  recent_offs[5] = -8;
  last_offset = -8;

  while (cmd_stream < cmd_stream_end) {
    const f = mem[cmd_stream++];
    let litlen = f & 3;
    const offs_index = f >> 6;
    let matchlen = (f >> 2) & 0xF;

    // use cmov
    const next_long_length = i32(len_stream);
    const next_len_stream = len_stream + 4;

    len_stream = (litlen === 3) ? next_len_stream : len_stream;
    litlen = (litlen === 3) ? next_long_length : litlen;
    recent_offs[6] = i32(offs_stream);

    copy64add(dst, lit_stream, dst + last_offset);
    if (litlen > 8) {
      copy64add(dst + 8, lit_stream + 8, dst + last_offset + 8);
      if (litlen > 16) {
        copy64add(dst + 16, lit_stream + 16, dst + last_offset + 16);
        if (litlen > 24) {
          do {
            copy64add(dst + 24, lit_stream + 24, dst + last_offset + 24);
            litlen -= 8;
            dst += 8;
            lit_stream += 8;
          } while (litlen > 24);
        }
      }
    }
    dst += litlen;
    lit_stream += litlen;

    offset = recent_offs[offs_index + 3];
    recent_offs[offs_index + 3] = recent_offs[offs_index + 2];
    recent_offs[offs_index + 2] = recent_offs[offs_index + 1];
    recent_offs[offs_index + 1] = recent_offs[offs_index + 0];
    recent_offs[3] = offset;
    last_offset = offset;

    offs_stream += (offs_index + 1) & 4;

    if (ultSigned(offset, dst_start - dst))
      return false; // offset out of bounds

    copyfrom = dst + offset;
    if (matchlen !== 15) {
      copy64(dst, copyfrom);
      copy64(dst + 8, copyfrom + 8);
      dst += matchlen + 2;
    } else {
      matchlen = 14 + i32(len_stream); len_stream += 4;
      if (ultSigned(dst_end - dst, matchlen))
        return false; // copy length out of bounds
      copy64(dst, copyfrom);
      copy64(dst + 8, copyfrom + 8);
      copy64(dst + 16, copyfrom + 16);
      do {
        copy64(dst + 24, copyfrom + 24);
        matchlen -= 8;
        dst += 8;
        copyfrom += 8;
      } while (matchlen > 24);
      dst += matchlen;
    }
  }

  // check for incorrect input
  if (offs_stream !== offs_stream_end || len_stream !== len_stream_end)
    return false;

  final_len = dst_end - dst;
  if (final_len !== lit_stream_end - lit_stream)
    return false;

  if (final_len >= 8) {
    do {
      copy64add(dst, lit_stream, dst + last_offset);
      dst += 8; lit_stream += 8; final_len -= 8;
    } while (final_len >= 8);
  }
  if (final_len > 0) {
    do {
      mem[dst] = mem[lit_stream++] + mem[dst + last_offset];
    } while (dst++, --final_len);
  }
  return true;
}

// Note: may access memory out of bounds on invalid input.
function Kraken_ProcessLzRuns_Type1(lzt, dst, dst_end, dst_start) {
  let cmd_stream = lzt.cmd_stream;
  const cmd_stream_end = cmd_stream + lzt.cmd_stream_size;
  let len_stream = lzt.len_stream;
  const len_stream_end = lzt.len_stream + 4 * lzt.len_stream_size;
  let lit_stream = lzt.lit_stream;
  const lit_stream_end = lzt.lit_stream + lzt.lit_stream_size;
  let offs_stream = lzt.offs_stream;
  const offs_stream_end = lzt.offs_stream + 4 * lzt.offs_stream_size;
  let copyfrom;
  let final_len;
  let offset;
  const recent_offs = new Int32Array(7);

  recent_offs[3] = -8;
  recent_offs[4] = -8;
  recent_offs[5] = -8;

  while (cmd_stream < cmd_stream_end) {
    const f = mem[cmd_stream++];
    let litlen = f & 3;
    const offs_index = f >> 6;
    let matchlen = (f >> 2) & 0xF;

    // use cmov
    const next_long_length = i32(len_stream);
    const next_len_stream = len_stream + 4;

    len_stream = (litlen === 3) ? next_len_stream : len_stream;
    litlen = (litlen === 3) ? next_long_length : litlen;
    recent_offs[6] = i32(offs_stream);

    copy64(dst, lit_stream);
    if (litlen > 8) {
      copy64(dst + 8, lit_stream + 8);
      if (litlen > 16) {
        copy64(dst + 16, lit_stream + 16);
        if (litlen > 24) {
          do {
            copy64(dst + 24, lit_stream + 24);
            litlen -= 8;
            dst += 8;
            lit_stream += 8;
          } while (litlen > 24);
        }
      }
    }
    dst += litlen;
    lit_stream += litlen;

    offset = recent_offs[offs_index + 3];
    recent_offs[offs_index + 3] = recent_offs[offs_index + 2];
    recent_offs[offs_index + 2] = recent_offs[offs_index + 1];
    recent_offs[offs_index + 1] = recent_offs[offs_index + 0];
    recent_offs[3] = offset;

    offs_stream += (offs_index + 1) & 4;

    if (ultSigned(offset, dst_start - dst))
      return false; // offset out of bounds

    copyfrom = dst + offset;
    if (matchlen !== 15) {
      copy64(dst, copyfrom);
      copy64(dst + 8, copyfrom + 8);
      dst += matchlen + 2;
    } else {
      matchlen = 14 + i32(len_stream); len_stream += 4;
      if (ultSigned(dst_end - dst, matchlen))
        return false; // copy length out of bounds
      copy64(dst, copyfrom);
      copy64(dst + 8, copyfrom + 8);
      copy64(dst + 16, copyfrom + 16);
      do {
        copy64(dst + 24, copyfrom + 24);
        matchlen -= 8;
        dst += 8;
        copyfrom += 8;
      } while (matchlen > 24);
      dst += matchlen;
    }
  }

  // check for incorrect input
  if (offs_stream !== offs_stream_end || len_stream !== len_stream_end)
    return false;

  final_len = dst_end - dst;
  if (final_len !== lit_stream_end - lit_stream)
    return false;

  if (final_len >= 64) {
    do {
      copy64bytes(dst, lit_stream);
      dst += 64; lit_stream += 64; final_len -= 64;
    } while (final_len >= 64);
  }
  if (final_len >= 8) {
    do {
      copy64(dst, lit_stream);
      dst += 8; lit_stream += 8; final_len -= 8;
    } while (final_len >= 8);
  }
  if (final_len > 0) {
    do {
      mem[dst++] = mem[lit_stream++];
    } while (--final_len);
  }
  return true;
}

function Kraken_ProcessLzRuns(mode, dst, dst_size, offset, lztable) {
  const dst_end = dst + dst_size;

  if (mode === 1)
    return Kraken_ProcessLzRuns_Type1(lztable, dst + (offset === 0 ? 8 : 0), dst_end, dst - offset);

  if (mode === 0)
    return Kraken_ProcessLzRuns_Type0(lztable, dst + (offset === 0 ? 8 : 0), dst_end, dst - offset);

  return false;
}

const SIZEOF_KRAKEN_LZTABLE = 64; // C: 48 on x64; padded to 64 for alignment

// Decode one 256kb big quantum block. It's divided into two 128k blocks
// internally that are compressed separately but with a shared history.
function Kraken_DecodeQuantum(dst, dst_end, dst_start, src, src_end, scratch, scratch_end) {
  const src_in = src;
  let mode, chunkhdr, dst_count, src_used;

  while (dst_end - dst !== 0) {
    dst_count = dst_end - dst;
    if (dst_count > 0x20000) dst_count = 0x20000;
    if (src_end - src < 4) return -1;
    chunkhdr = mem[src + 2] | (mem[src + 1] << 8) | (mem[src] << 16);
    if (!(chunkhdr & 0x800000)) {
      // Stored as entropy without any match copying.
      const ref = { output: dst, decodedSize: 0 };
      src_used = Kraken_DecodeBytes(ref, src, src_end, dst_count, false, scratch, scratch_end);
      if (src_used < 0 || ref.decodedSize !== dst_count) return -1;
      if (ref.output !== dst) memmove(dst, ref.output, dst_count);
    } else {
      src += 3;
      src_used = chunkhdr & 0x7FFFF;
      mode = (chunkhdr >> 19) & 0xF;
      if (src_end - src < src_used) return -1;
      if (src_used < dst_count) {
        const scratch_usage = Math.min(Math.min(3 * dst_count + 32 + 0xD000, 0x6C000), scratch_end - scratch);
        if (scratch_usage < SIZEOF_KRAKEN_LZTABLE) return -1;
        const lztable = {
          cmd_stream: 0, cmd_stream_size: 0,
          offs_stream: 0, offs_stream_size: 0,
          lit_stream: 0, lit_stream_size: 0,
          len_stream: 0, len_stream_size: 0,
        };
        if (!Kraken_ReadLzTable(mode, src, src + src_used, dst, dst_count, dst - dst_start,
                                scratch + SIZEOF_KRAKEN_LZTABLE, scratch + scratch_usage, lztable))
          return -1;
        if (!Kraken_ProcessLzRuns(mode, dst, dst_count, dst - dst_start, lztable))
          return -1;
      } else if (src_used > dst_count || mode !== 0) {
        return -1;
      } else {
        memmove(dst, src, dst_count);
      }
    }
    src += src_used;
    dst += dst_count;
  }
  return src - src_in;
}

// ---- Mermaid/Selkie ---------------------------------------------------------------

// output: heap ptr to u32 array. Returns bytes consumed or -1.
function Mermaid_DecodeFarOffsets(src, src_end, output, output_size, offset) {
  let src_cur = src;
  let off;

  if (offset < (0xC00000 - 1)) {
    for (let i = 0; i !== output_size; i++) {
      if (src_end - src_cur < 3) return -1;
      off = mem[src_cur] | (mem[src_cur + 1] << 8) | (mem[src_cur + 2] << 16);
      src_cur += 3;
      wu32(output + 4 * i, off);
      if (off > offset) return -1;
    }
    return src_cur - src;
  }

  for (let i = 0; i !== output_size; i++) {
    if (src_end - src_cur < 3) return -1;
    off = mem[src_cur] | (mem[src_cur + 1] << 8) | (mem[src_cur + 2] << 16);
    src_cur += 3;

    if (off >= 0xC00000) {
      if (src_cur === src_end) return -1;
      off = (off + (mem[src_cur++] << 22)) >>> 0;
    }
    wu32(output + 4 * i, off);
    if (off > offset) return -1;
  }
  return src_cur - src;
}

function Mermaid_CombineOffs16(dst, size, lo, hi) {
  for (let i = 0; i !== size; i++)
    wu16(dst + 2 * i, mem[lo + i] + mem[hi + i] * 256);
}

// lz: JS object mirroring MermaidLzTable (all stream fields are heap byte offsets).
function Mermaid_ReadLzTable(mode, src, src_end, dst, dst_size, offset, scratch, scratch_end, lz) {
  let n;
  let tmp, off32_size_2, off32_size_1;

  if (mode > 1) return false;

  if (src_end - src < 10) return false;

  if (offset === 0) {
    copy64(dst, src);
    dst += 8;
    src += 8;
  }

  const ref = { output: 0, decodedSize: 0 };

  // Decode lit stream
  ref.output = scratch;
  n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size), false, scratch, scratch_end);
  if (n < 0) return false;
  src += n;
  lz.lit_stream = ref.output;
  lz.lit_stream_end = ref.output + ref.decodedSize;
  scratch += ref.decodedSize;

  // Decode flag stream
  ref.output = scratch;
  n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size), false, scratch, scratch_end);
  if (n < 0) return false;
  src += n;
  lz.cmd_stream = ref.output;
  lz.cmd_stream_end = ref.output + ref.decodedSize;
  scratch += ref.decodedSize;

  lz.cmd_stream_2_offs_end = ref.decodedSize;
  if (dst_size <= 0x10000) {
    lz.cmd_stream_2_offs = ref.decodedSize;
  } else {
    if (src_end - src < 2) return false;
    lz.cmd_stream_2_offs = u16(src);
    src += 2;
    if (lz.cmd_stream_2_offs > lz.cmd_stream_2_offs_end) return false;
  }

  if (src_end - src < 2) return false;

  const off16_count = u16(src);
  if (off16_count === 0xFFFF) {
    // off16 is entropy coded
    let off16_lo, off16_hi;
    let off16_lo_count, off16_hi_count;
    src += 2;
    ref.output = scratch;
    n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size >> 1), false, scratch, scratch_end);
    if (n < 0) return false;
    off16_hi = ref.output;
    off16_hi_count = ref.decodedSize;
    src += n;
    scratch += off16_hi_count;

    ref.output = scratch;
    n = Kraken_DecodeBytes(ref, src, src_end, Math.min(scratch_end - scratch, dst_size >> 1), false, scratch, scratch_end);
    if (n < 0) return false;
    off16_lo = ref.output;
    off16_lo_count = ref.decodedSize;
    src += n;
    scratch += off16_lo_count;

    if (off16_lo_count !== off16_hi_count) return false;
    scratch = (scratch + 1) & ~1;
    lz.off16_stream = scratch;
    if (scratch + off16_lo_count * 2 > scratch_end) return false;
    scratch += off16_lo_count * 2;
    lz.off16_stream_end = scratch;
    Mermaid_CombineOffs16(lz.off16_stream, off16_lo_count, off16_lo, off16_hi);
  } else {
    lz.off16_stream = src + 2;
    src += 2 + off16_count * 2;
    lz.off16_stream_end = src;
  }

  if (src_end - src < 3) return false;
  tmp = mem[src] | (mem[src + 1] << 8) | (mem[src + 2] << 16);
  src += 3;

  if (tmp !== 0) {
    off32_size_1 = tmp >>> 12;
    off32_size_2 = tmp & 0xFFF;
    if (off32_size_1 === 4095) {
      if (src_end - src < 2) return false;
      off32_size_1 = u16(src);
      src += 2;
    }
    if (off32_size_2 === 4095) {
      if (src_end - src < 2) return false;
      off32_size_2 = u16(src);
      src += 2;
    }
    lz.off32_size_1 = off32_size_1;
    lz.off32_size_2 = off32_size_2;

    if (scratch + 4 * (off32_size_2 + off32_size_1) + 64 > scratch_end) return false;

    scratch = (scratch + 3) & ~3;

    lz.off32_stream_1 = scratch;
    scratch += off32_size_1 * 4;
    // store dummy bytes after for prefetcher.
    memset(scratch, 0, 32);
    scratch += 32;

    lz.off32_stream_2 = scratch;
    scratch += off32_size_2 * 4;
    // store dummy bytes after for prefetcher.
    memset(scratch, 0, 32);
    scratch += 32;

    n = Mermaid_DecodeFarOffsets(src, src_end, lz.off32_stream_1, lz.off32_size_1, offset);
    if (n < 0) return false;
    src += n;

    n = Mermaid_DecodeFarOffsets(src, src_end, lz.off32_stream_2, lz.off32_size_2, offset + 0x10000);
    if (n < 0) return false;
    src += n;
  } else {
    if (scratch_end - scratch < 32) return false;
    lz.off32_size_1 = 0;
    lz.off32_size_2 = 0;
    lz.off32_stream_1 = scratch;
    lz.off32_stream_2 = scratch;
    // store dummy bytes after for prefetcher.
    memset(scratch, 0, 32);
  }
  lz.length_stream = src;
  return true;
}

// Returns final length_stream ptr, or -1 on error (C returned NULL).
function Mermaid_Mode0(dst, dst_size, dst_ptr_end, dst_start, src_end, lz, saved_dist_ref, startoff) {
  const dst_end = dst + dst_size;
  let cmd_stream = lz.cmd_stream;
  const cmd_stream_end = lz.cmd_stream_end;
  let length_stream = lz.length_stream;
  let lit_stream = lz.lit_stream;
  const lit_stream_end = lz.lit_stream_end;
  let off16_stream = lz.off16_stream;
  const off16_stream_end = lz.off16_stream_end;
  let off32_stream = lz.off32_stream;
  const off32_stream_end = lz.off32_stream_end;
  let recent_offs = saved_dist_ref.value;
  let match;
  let length;
  const dst_begin = dst;

  dst += startoff;

  while (cmd_stream < cmd_stream_end) {
    const cmd = mem[cmd_stream++];
    if (cmd >= 24) {
      const new_dist = u16(off16_stream);
      const use_distance = (cmd >> 7) === 0; // C: (cmd>>7)-1 == all-ones iff cmd<128
      const litlen = cmd & 7;
      copy64add(dst, lit_stream, dst + recent_offs);
      dst += litlen;
      lit_stream += litlen;
      if (use_distance) {
        recent_offs = -new_dist;
        off16_stream += 2;
      }
      match = dst + recent_offs;
      copy64(dst, match);
      copy64(dst + 8, match + 8);
      dst += (cmd >> 3) & 0xF;
    } else if (cmd > 2) {
      length = cmd + 5;

      if (off32_stream === off32_stream_end) return -1;
      match = dst_begin - u32(off32_stream); off32_stream += 4;
      recent_offs = match - dst;

      if (dst_end - dst < length) return -1;
      copy64(dst, match);
      copy64(dst + 8, match + 8);
      copy64(dst + 16, match + 16);
      copy64(dst + 24, match + 24);
      dst += length;
    } else if (cmd === 0) {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;

      length += 64;
      if (dst_end - dst < length || lit_stream_end - lit_stream < length) return -1;

      do {
        copy64add(dst, lit_stream, dst + recent_offs);
        copy64add(dst + 8, lit_stream + 8, dst + recent_offs + 8);
        dst += 16;
        lit_stream += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
      lit_stream += length;
    } else if (cmd === 1) {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;
      length += 91;

      if (off16_stream === off16_stream_end) return -1;
      match = dst - u16(off16_stream); off16_stream += 2;
      recent_offs = match - dst;
      do {
        copy64(dst, match);
        copy64(dst + 8, match + 8);
        dst += 16;
        match += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
    } else /* cmd == 2 */ {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;
      length += 29;
      if (off32_stream === off32_stream_end) return -1;
      match = dst_begin - u32(off32_stream); off32_stream += 4;
      recent_offs = match - dst;
      do {
        copy64(dst, match);
        copy64(dst + 8, match + 8);
        dst += 16;
        match += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
    }
  }

  length = dst_end - dst;
  if (length >= 8) {
    do {
      copy64add(dst, lit_stream, dst + recent_offs);
      dst += 8;
      lit_stream += 8;
      length -= 8;
    } while (length >= 8);
  }
  if (length > 0) {
    do {
      mem[dst] = mem[lit_stream++] + mem[dst + recent_offs];
      dst++;
    } while (--length);
  }

  saved_dist_ref.value = recent_offs;
  lz.length_stream = length_stream;
  lz.off16_stream = off16_stream;
  lz.lit_stream = lit_stream;
  return length_stream;
}

function Mermaid_Mode1(dst, dst_size, dst_ptr_end, dst_start, src_end, lz, saved_dist_ref, startoff) {
  const dst_end = dst + dst_size;
  let cmd_stream = lz.cmd_stream;
  const cmd_stream_end = lz.cmd_stream_end;
  let length_stream = lz.length_stream;
  let lit_stream = lz.lit_stream;
  const lit_stream_end = lz.lit_stream_end;
  let off16_stream = lz.off16_stream;
  const off16_stream_end = lz.off16_stream_end;
  let off32_stream = lz.off32_stream;
  const off32_stream_end = lz.off32_stream_end;
  let recent_offs = saved_dist_ref.value;
  let match;
  let length;
  const dst_begin = dst;

  dst += startoff;

  while (cmd_stream < cmd_stream_end) {
    const flag = mem[cmd_stream++];
    if (flag >= 24) {
      const new_dist = u16(off16_stream);
      const use_distance = (flag >> 7) === 0;
      const litlen = flag & 7;
      copy64(dst, lit_stream);
      dst += litlen;
      lit_stream += litlen;
      if (use_distance) {
        recent_offs = -new_dist;
        off16_stream += 2;
      }
      match = dst + recent_offs;
      copy64(dst, match);
      copy64(dst + 8, match + 8);
      dst += (flag >> 3) & 0xF;
    } else if (flag > 2) {
      length = flag + 5;

      if (off32_stream === off32_stream_end) return -1;
      match = dst_begin - u32(off32_stream); off32_stream += 4;
      recent_offs = match - dst;

      if (dst_end - dst < length) return -1;
      copy64(dst, match);
      copy64(dst + 8, match + 8);
      copy64(dst + 16, match + 16);
      copy64(dst + 24, match + 24);
      dst += length;
    } else if (flag === 0) {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;

      length += 64;
      if (dst_end - dst < length || lit_stream_end - lit_stream < length) return -1;

      do {
        copy64(dst, lit_stream);
        copy64(dst + 8, lit_stream + 8);
        dst += 16;
        lit_stream += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
      lit_stream += length;
    } else if (flag === 1) {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;
      length += 91;

      if (off16_stream === off16_stream_end) return -1;
      match = dst - u16(off16_stream); off16_stream += 2;
      recent_offs = match - dst;
      do {
        copy64(dst, match);
        copy64(dst + 8, match + 8);
        dst += 16;
        match += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
    } else /* flag == 2 */ {
      if (src_end - length_stream === 0) return -1;
      length = mem[length_stream];
      if (length > 251) {
        if (src_end - length_stream < 3) return -1;
        length += u16(length_stream + 1) * 4;
        length_stream += 2;
      }
      length_stream += 1;
      length += 29;

      if (off32_stream === off32_stream_end) return -1;
      match = dst_begin - u32(off32_stream); off32_stream += 4;
      recent_offs = match - dst;

      do {
        copy64(dst, match);
        copy64(dst + 8, match + 8);
        dst += 16;
        match += 16;
        length -= 16;
      } while (length > 0);
      dst += length;
    }
  }

  length = dst_end - dst;
  if (length >= 8) {
    do {
      copy64(dst, lit_stream);
      dst += 8;
      lit_stream += 8;
      length -= 8;
    } while (length >= 8);
  }
  if (length > 0) {
    do {
      mem[dst++] = mem[lit_stream++];
    } while (--length);
  }

  saved_dist_ref.value = recent_offs;
  lz.length_stream = length_stream;
  lz.off16_stream = off16_stream;
  lz.lit_stream = lit_stream;
  return length_stream;
}

function Mermaid_ProcessLzRuns(mode, src, src_end, dst, dst_size, offset, dst_end, lz) {
  const dst_start = dst - offset;
  const saved_dist_ref = { value: -8 };
  let src_cur = -1;

  for (let iteration = 0; iteration !== 2; iteration++) {
    let dst_size_cur = dst_size;
    if (dst_size_cur > 0x10000) dst_size_cur = 0x10000;

    if (iteration === 0) {
      lz.off32_stream = lz.off32_stream_1;
      lz.off32_stream_end = lz.off32_stream_1 + lz.off32_size_1 * 4 * 4; // C quirk: uint32* + n*4 elements
      lz.cmd_stream_end = lz.cmd_stream + lz.cmd_stream_2_offs;
    } else {
      lz.off32_stream = lz.off32_stream_2;
      lz.off32_stream_end = lz.off32_stream_2 + lz.off32_size_2 * 4 * 4;
      lz.cmd_stream_end = lz.cmd_stream + lz.cmd_stream_2_offs_end;
      lz.cmd_stream += lz.cmd_stream_2_offs;
    }

    if (mode === 0) {
      src_cur = Mermaid_Mode0(dst, dst_size_cur, dst_end, dst_start, src_end, lz, saved_dist_ref,
        (offset === 0 && iteration === 0) ? 8 : 0);
    } else {
      src_cur = Mermaid_Mode1(dst, dst_size_cur, dst_end, dst_start, src_end, lz, saved_dist_ref,
        (offset === 0 && iteration === 0) ? 8 : 0);
    }
    if (src_cur < 0) return false;

    dst += dst_size_cur;
    dst_size -= dst_size_cur;
    if (dst_size === 0) break;
  }

  if (src_cur !== src_end) return false;

  return true;
}

const SIZEOF_MERMAID_LZTABLE = 112; // C: 104 on x64, padded

function Mermaid_DecodeQuantum(dst, dst_end, dst_start, src, src_end, temp, temp_end) {
  const src_in = src;
  let mode, chunkhdr, dst_count, src_used;

  while (dst_end - dst !== 0) {
    dst_count = dst_end - dst;
    if (dst_count > 0x20000) dst_count = 0x20000;
    if (src_end - src < 4) return -1;
    chunkhdr = mem[src + 2] | (mem[src + 1] << 8) | (mem[src] << 16);
    if (!(chunkhdr & 0x800000)) {
      // Stored without any match copying.
      const ref = { output: dst, decodedSize: 0 };
      src_used = Kraken_DecodeBytes(ref, src, src_end, dst_count, false, temp, temp_end);
      if (src_used < 0 || ref.decodedSize !== dst_count) return -1;
      if (ref.output !== dst) memmove(dst, ref.output, dst_count);
    } else {
      src += 3;
      src_used = chunkhdr & 0x7FFFF;
      mode = (chunkhdr >> 19) & 0xF;
      if (src_end - src < src_used) return -1;
      if (src_used < dst_count) {
        let temp_usage = 2 * dst_count + 32;
        if (temp_usage > 0x40000) temp_usage = 0x40000;
        const lz = {
          cmd_stream: 0, cmd_stream_end: 0,
          length_stream: 0,
          lit_stream: 0, lit_stream_end: 0,
          off16_stream: 0, off16_stream_end: 0,
          off32_stream: 0, off32_stream_end: 0,
          off32_stream_1: 0, off32_stream_2: 0,
          off32_size_1: 0, off32_size_2: 0,
          cmd_stream_2_offs: 0, cmd_stream_2_offs_end: 0,
        };
        if (!Mermaid_ReadLzTable(mode, src, src + src_used, dst, dst_count, dst - dst_start,
                                 temp + SIZEOF_MERMAID_LZTABLE, temp + temp_usage, lz))
          return -1;
        if (!Mermaid_ProcessLzRuns(mode, src, src + src_used, dst, dst_count, dst - dst_start, dst_end, lz))
          return -1;
      } else if (src_used > dst_count || mode !== 0) {
        return -1;
      } else {
        memmove(dst, src, dst_count);
      }
    }
    src += src_used;
    dst += dst_count;
  }
  return src - src_in;
}

// ---- top-level orchestration ---------------------------------------------------

function Kraken_CopyWholeMatch(dst, offset, length) {
  let i = 0;
  const src = dst - offset;
  if (offset >= 8) {
    for (; i + 8 <= length; i += 8)
      copy64(dst + i, src + i);
  }
  for (; i < length; i++)
    mem[dst + i] = mem[src + i];
}

function Kraken_DecodeStep(dec, dst_start, offset, dst_bytes_left_in, src, src_bytes_left) {
  const src_in = src;
  const src_end = src + src_bytes_left;
  const qhdr = { compressed_size: 0, checksum: 0, flag1: 0, flag2: 0, whole_match_distance: 0 };
  let n;

  if ((offset & 0x3FFFF) === 0) {
    src = Kraken_ParseHeader(dec.hdr, src);
    if (!src) return false;
  }

  const is_kraken_decoder = (dec.hdr.decoder_type === 6 || dec.hdr.decoder_type === 10 || dec.hdr.decoder_type === 12);

  const dst_bytes_left = Math.min(is_kraken_decoder ? 0x40000 : 0x4000, dst_bytes_left_in);

  if (dec.hdr.uncompressed) {
    if (src_end - src < dst_bytes_left) {
      dec.src_used = dec.dst_used = 0;
      return true;
    }
    memmove(dst_start + offset, src, dst_bytes_left);
    dec.src_used = (src - src_in) + dst_bytes_left;
    dec.dst_used = dst_bytes_left;
    return true;
  }

  if (is_kraken_decoder) {
    src = Kraken_ParseQuantumHeader(qhdr, src, dec.hdr.use_checksums);
  } else {
    return false; // LZNA/Bitknit quantum headers not ported
  }

  if (!src || src > src_end) return false;

  // Too few bytes in buffer to make any progress?
  if (src_end - src < qhdr.compressed_size) {
    dec.src_used = dec.dst_used = 0;
    return true;
  }

  if (qhdr.compressed_size > dst_bytes_left) return false;

  if (qhdr.compressed_size === 0) {
    if (qhdr.whole_match_distance !== 0) {
      if (qhdr.whole_match_distance > offset) return false;
      Kraken_CopyWholeMatch(dst_start + offset, qhdr.whole_match_distance, dst_bytes_left);
    } else {
      memset(dst_start + offset, qhdr.checksum, dst_bytes_left);
    }
    dec.src_used = src - src_in;
    dec.dst_used = dst_bytes_left;
    return true;
  }

  // (checksums not verified in this port)

  if (qhdr.compressed_size === dst_bytes_left) {
    memmove(dst_start + offset, src, dst_bytes_left);
    dec.src_used = (src - src_in) + dst_bytes_left;
    dec.dst_used = dst_bytes_left;
    return true;
  }

  if (dec.hdr.decoder_type === 6) {
    n = Kraken_DecodeQuantum(dst_start + offset, dst_start + offset + dst_bytes_left, dst_start,
                             src, src + qhdr.compressed_size,
                             dec.scratch, dec.scratch + dec.scratch_size);
  } else if (dec.hdr.decoder_type === 10) {
    n = Mermaid_DecodeQuantum(dst_start + offset, dst_start + offset + dst_bytes_left, dst_start,
                              src, src + qhdr.compressed_size,
                              dec.scratch, dec.scratch + dec.scratch_size);
  } else {
    return false; // LZNA (5), Bitknit (11), Leviathan (12) not ported
  }

  if (n !== qhdr.compressed_size) return false;

  dec.src_used = (src - src_in) + n;
  dec.dst_used = dst_bytes_left;
  return true;
}

function Kraken_Decompress_impl(src, src_len, dst, dst_len) {
  const dec = {
    src_used: 0, dst_used: 0,
    scratch: 0, scratch_size: 0x6C000,
    hdr: { decoder_type: 0, restart_decoder: 0, uncompressed: 0, use_checksums: false },
  };
  dec.scratch = SCRATCH_BASE;
  let offset = 0;
  while (dst_len !== 0) {
    if (!Kraken_DecodeStep(dec, dst, offset, dst_len, src, src_len))
      return -1;
    if (dec.src_used === 0)
      return -1;
    src += dec.src_used;
    src_len -= dec.src_used;
    dst_len -= dec.dst_used;
    offset += dec.dst_used;
  }
  if (src_len !== 0) return -1;
  return offset;
}

// ---- public API ------------------------------------------------------------------

let SCRATCH_BASE = 0;

// Decompress an Oodle (Kraken/Mermaid/Selkie) stream. srcBytes: Uint8Array of the
// raw compressed payload (after the 12-byte PlM sav header). dstLen: expected
// uncompressed size. Returns a fresh Uint8Array of length dstLen. Throws on error.
function oodleDecompress(srcBytes, dstLen) {
  const GUARD = 64;
  const srcLen = srcBytes.length;
  const SRC = GUARD;
  let p = SRC + srcLen + 64;
  p = (p + 15) & ~15;
  SCRATCH_BASE = p;
  p += 0x6C000;
  const STACK_SIZE = 0x20000;
  const STACK = p;
  p += STACK_SIZE;
  p = (p + 15) & ~15;
  const DST = p;
  p += dstLen + 128; // decoder overshoots dst by design; slack absorbs it

  mem = new Uint8Array(p);
  dv = new DataView(mem.buffer);
  mem.set(srcBytes, SRC);
  stackPtr = STACK;
  stackLimit = STACK + STACK_SIZE;

  const result = Kraken_Decompress_impl(SRC, srcLen, DST, dstLen);
  if (result !== dstLen)
    throw new Error(`oodle: decompression failed (got ${result}, expected ${dstLen})`);

  const out = mem.slice(DST, DST + dstLen);
  mem = null; dv = null; // release the heap
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { oodleDecompress };
} else {
  (globalThis.PalTools = globalThis.PalTools || {}).oodleDecompress = oodleDecompress;
}

})();
