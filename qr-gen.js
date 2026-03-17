/**
 * qr-gen.js — Pure JS QR Code Generator (no dependencies)
 * Implements byte-mode encoding, Reed-Solomon ECC, module placement, masking.
 * Exposes: window.QRGen.toCanvas(text, canvasEl, size, dark, light)
 *          window.QRGen.toDataURL(text, size, dark, light) → data URL
 */
(function(global) {
'use strict';

/* ── Galois Field GF(256) ── */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
function gfPoly(degree) {
  let p = [1];
  for (let i = 0; i < degree; i++) {
    const q = [1, EXP[i]];
    const r = new Uint8Array(p.length + 1);
    for (let j = 0; j < p.length; j++) for (let k = 0; k < q.length; k++) r[j+k] ^= gfMul(p[j], q[k]);
    p = Array.from(r);
  }
  return p;
}
function rsEncode(data, nec) {
  const gen = gfPoly(nec);
  const msg = new Uint8Array(data.length + nec);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = msg[i];
    if (c !== 0) for (let j = 1; j < gen.length; j++) msg[i+j] ^= gfMul(gen[j], c);
  }
  return msg.slice(data.length);
}

/* ── QR Version / capacity tables (byte mode, error level M) ── */
// [version, total_codewords, data_codewords, ec_per_block, blocks]
const VERSIONS = [
  [1,  26,  16, 10, 1], [2,  44,  28, 16, 1], [3,  70,  44, 26, 1],
  [4,  100, 64, 18, 2], [5,  134, 86, 24, 2], [6,  172,108, 16, 4],
  [7,  196,124, 18, 4], [8,  242,154, 22, 4], [9,  292,182, 22, 5],
  [10, 346,216, 26, 5], [11, 404,254, 30, 5], [12, 466,290, 22, 8],
  [13, 532,334, 22, 8], [14, 581,365, 24, 8], [15, 655,415, 24, 8],
  [16, 733,453, 28, 8], [17, 815,507, 28, 8], [18, 901,563, 26,10],
  [19, 991,627, 26,10], [20,1085,669, 26,12],
];

function pickVersion(len) {
  // byte mode overhead: 4 (mode) + 8 (char count) + 4 (terminator) bits = ceil/8 extra bytes
  for (const v of VERSIONS) if (v[2] >= len + 3) return v;
  throw new Error('Data too long for QR (max ~650 bytes)');
}

/* ── Bit buffer ── */
function BitBuf() {
  const bits = [];
  return {
    push(val, n) { for (let i = n-1; i >= 0; i--) bits.push((val >> i) & 1); },
    pad(target) {
      const PAD = [0xEC, 0x11];
      while (bits.length < target * 8) { this.push(PAD[0], 8); if (bits.length < target * 8) this.push(PAD[1], 8); }
    },
    toBytes() {
      const out = new Uint8Array(Math.ceil(bits.length / 8));
      for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
      return out;
    }
  };
}

/* ── Encode data codewords ── */
function encodeData(text, ver) {
  const bytes = new TextEncoder().encode(text);
  const [,, dataCW, ecPerBlock, blocks] = ver;
  const buf = BitBuf();
  buf.push(0b0100, 4);          // byte mode
  buf.push(bytes.length, 8);    // char count (version 1-9: 8 bits)
  for (const b of bytes) buf.push(b, 8);
  buf.push(0, 4);               // terminator
  buf.pad(dataCW);
  const raw = buf.toBytes().slice(0, dataCW);

  // Split into blocks and add RS
  const shortBlocks = blocks - (dataCW % blocks);
  const shortLen    = Math.floor(dataCW / blocks);
  const allData = [], allEC = [];
  let pos = 0;
  for (let b = 0; b < blocks; b++) {
    const len  = b < shortBlocks ? shortLen : shortLen + 1;
    const chunk = raw.slice(pos, pos + len); pos += len;
    allData.push(chunk);
    allEC.push(rsEncode(chunk, ecPerBlock));
  }

  // Interleave
  const cw = [];
  const maxLen = allData[allData.length-1].length;
  for (let i = 0; i < maxLen; i++) for (const d of allData) if (i < d.length) cw.push(d[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const e of allEC) cw.push(e[i]);
  return cw;
}

/* ── Module matrix builder ── */
function makeMatrix(size) {
  const m = Array.from({length: size}, () => new Int8Array(size).fill(-1));
  return m;
}

function setModule(m, r, c, val) { if (r >= 0 && r < m.length && c >= 0 && c < m.length) m[r][c] = val; }

function placeFinder(m, r, c) {
  for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
    const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
    const border  = dr === 0 || dr === 6 || dc === 0 || dc === 6;
    const inner   = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
    setModule(m, r+dr, c+dc, (inside && (border || inner)) ? 1 : 0);
  }
}

function placeAlign(m, r, c) {
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const border = Math.abs(dr) === 2 || Math.abs(dc) === 2;
    const center = dr === 0 && dc === 0;
    setModule(m, r+dr, c+dc, (border || center) ? 1 : 0);
  }
}

// Alignment pattern centres per version
const ALIGN_COORDS = [
  [], [], [6,18], [6,22], [6,26], [6,30], [6,34],
  [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54],
  [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70], [6,26,50,74],
  [6,30,54,78], [6,30,56,82], [6,30,58,86],
];

function buildMatrix(version, codewords) {
  const size = version * 4 + 17;
  const m = makeMatrix(size);

  // Finders + separators
  placeFinder(m, 0, 0); placeFinder(m, 0, size-7); placeFinder(m, size-7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(m, 6, i, (i & 1) ? 0 : 1);
    setModule(m, i, 6, (i & 1) ? 0 : 1);
  }

  // Dark module
  setModule(m, size - 8, 8, 1);

  // Alignment patterns
  const ac = ALIGN_COORDS[version - 1] || [];
  for (const r of ac) for (const c of ac) {
    if (m[r][c] === -1) placeAlign(m, r, c);
  }

  // Reserve format areas (leave -1 but mark as used=2)
  const markFmt = (r, c) => { if (m[r][c] === -1) m[r][c] = 2; };
  for (let i = 0; i <= 8; i++) { markFmt(8, i); markFmt(i, 8); }
  for (let i = 0; i <= 7; i++) { markFmt(8, size-1-i); markFmt(size-1-i, 8); }

  // Place data bits (zigzag)
  let bit = 0, dir = -1, row = size - 1;
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col--;
    for (let cnt = 0; cnt < size; cnt++) {
      const r = row;
      for (let d = 0; d < 2; d++) {
        const c = col - d;
        if (m[r][c] === -1 && bit < codewords.length * 8) {
          m[r][c] = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
          bit++;
        }
      }
      row += dir;
    }
    dir = -dir; row += dir;
  }

  return m;
}

/* ── Mask pattern 0 (checkerboard) ── */
function applyMask(m, mask=0) {
  const size = m.length;
  const MASKS = [
    (r,c) => (r+c) % 2 === 0,
    (r,c) => r % 2 === 0,
    (r,c) => c % 3 === 0,
    (r,c) => (r+c) % 3 === 0,
    (r,c) => (Math.floor(r/2)+Math.floor(c/3)) % 2 === 0,
    (r,c) => (r*c)%2 + (r*c)%3 === 0,
    (r,c) => ((r*c)%2+(r*c)%3) % 2 === 0,
    (r,c) => ((r+c)%2+(r*c)%3) % 2 === 0,
  ];
  const fn = MASKS[mask];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (m[r][c] === 0 || m[r][c] === 1) {
      if (fn(r, c)) m[r][c] ^= 1;
    }
  }
}

/* ── Format string (EC level M = 00, mask 0 = 000) ── */
// Pre-computed format info for M/mask-0 = 101010000010010
const FORMAT_M0 = [1,0,1,0,1,0,0,0,0,0,1,0,0,1,0];
function writeFormat(m) {
  const size = m.length;
  const f = FORMAT_M0;
  // Around top-left finder
  const pos1 = [8,8,8,8,8,8,8,8,7,5,4,3,2,1,0].map((v,i) => [v < 8 ? 8 : i, v < 8 ? i : 8]);
  // Actually use standard positions:
  const hPos = [0,1,2,3,4,5,7,8,  size-8,size-7,size-6,size-5,size-4,size-3,size-2,size-1];
  const vPos = [size-1,size-2,size-3,size-4,size-5,size-6,size-7,  8, 8,8,8,8,8,8,8];
  // Horizontal (row 8)
  let fi = 0;
  for (let c = 0; c <= 5; c++) m[8][c] = f[fi++];
  m[8][7] = f[fi++];
  m[8][8] = f[fi++];
  for (let c = size-7; c < size; c++) m[8][c] = f[fi++];
  // Vertical (col 8)
  fi = 0;
  for (let r = size-1; r >= size-7; r--) m[r][8] = f[fi++];
  m[8][8] = f[fi++]; // overlap, same value
  m[7][8] = f[fi++];
  for (let r = 5; r >= 0; r--) m[r][8] = f[fi++];
}

/* ── Master encode ── */
function encode(text, maskIdx = 0) {
  const bytes = new TextEncoder().encode(text);
  const ver   = pickVersion(bytes.length);
  const cw    = encodeData(text, ver);
  const m     = buildMatrix(ver[0], cw);
  applyMask(m, maskIdx);
  writeFormat(m);
  // Replace any remaining -1 or 2 (reserved) with 0
  for (const row of m) for (let i = 0; i < row.length; i++) if (row[i] < 0 || row[i] === 2) row[i] = 0;
  return m;
}

/* ── Render to canvas ── */
function toCanvas(text, canvas, size, dark='#000000', light='#ffffff') {
  const m    = encode(text);
  const mods = m.length;
  const scale = Math.floor(size / (mods + 8)); // 4-module quiet zone on each side
  const off   = Math.floor((size - mods * scale) / 2);
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = dark;
  for (let r = 0; r < mods; r++) for (let c = 0; c < mods; c++) {
    if (m[r][c] === 1) ctx.fillRect(off + c * scale, off + r * scale, scale, scale);
  }
}

/* ── Render to data URL ── */
function toDataURL(text, size=200, dark='#000000', light='#ffffff') {
  const canvas = document.createElement('canvas');
  toCanvas(text, canvas, size, dark, light);
  return canvas.toDataURL();
}

/* ── Render to div (img tag) ── */
function toDiv(text, container, size=200, dark='#000000', light='#ffffff') {
  const url = toDataURL(text, size, dark, light);
  const img  = document.createElement('img');
  img.src    = url;
  img.width  = size;
  img.height = size;
  img.style.display = 'block';
  container.innerHTML = '';
  container.appendChild(img);
}

global.QRGen = { toCanvas, toDataURL, toDiv, encode };
})(window);
