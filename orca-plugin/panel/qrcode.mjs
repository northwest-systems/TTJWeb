/**
 * Offline ISO/IEC 18004 QR Code encoder (Byte mode, ECC L/M, Versions 1-10) with SVG renderer.
 * Zero external dependencies and zero network access.
 */

const MIN_VERSION = 1;
const MAX_VERSION = 10;

// [ecCodewordsPerBlock, group1Blocks, group1DataCW, group2Blocks, group2DataCW]
const ECC_TABLES = {
  L: [
    null,
    [7, 1, 19, 0, 0],
    [10, 1, 34, 0, 0],
    [15, 1, 55, 0, 0],
    [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0],
    [20, 2, 78, 0, 0],
    [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0],
    [18, 2, 68, 2, 69],
  ],
  M: [
    null,
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
  ],
};

// Format indicator bits for ECC level (ISO/IEC 18004 Table 25)
const ECC_FORMAT_BITS = {
  L: 0b01,
  M: 0b00,
};

// Alignment pattern center coordinates for versions 1-10 (ISO/IEC 18004 Annex E)
const ALIGNMENT_CENTERS = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// Remainder bits appended after interleaved codewords
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(dataBytes, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    for (let j = 0; j < ecCount - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecCount - 1] = gfMul(gen[ecCount], factor);
  }
  return rem;
}

function totalDataCodewords(version, ecc) {
  const [, g1Blocks, g1Data, g2Blocks, g2Data] = ECC_TABLES[ecc][version];
  return g1Blocks * g1Data + g2Blocks * g2Data;
}

function byteCountBitsForVersion(version) {
  return version <= 9 ? 8 : 16;
}

function selectVersion(byteLength, ecc) {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = totalDataCodewords(version, ecc) * 8;
    const neededBits = 4 + byteCountBitsForVersion(version) + byteLength * 8;
    if (neededBits <= capacityBits) {
      return version;
    }
  }
  throw new Error(
    `QR コードの最大容量（Version ${MAX_VERSION}, ECC ${ecc}）を超えています（${byteLength} bytes）。`,
  );
}

function appendBits(bitArray, value, length) {
  for (let i = length - 1; i >= 0; i--) {
    bitArray.push((value >>> i) & 1);
  }
}

function buildDataCodewords(utf8Bytes, version, ecc) {
  const dataCWCount = totalDataCodewords(version, ecc);
  const capacityBits = dataCWCount * 8;
  const bits = [];

  // Mode indicator: Byte (0100)
  appendBits(bits, 0b0100, 4);
  // Character count indicator
  appendBits(bits, utf8Bytes.length, byteCountBitsForVersion(version));
  // Payload bytes
  for (let i = 0; i < utf8Bytes.length; i++) {
    appendBits(bits, utf8Bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, terminatorLen);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Convert bits to bytes
  const codewords = new Uint8Array(dataCWCount);
  const usedBytes = bits.length / 8;
  for (let i = 0; i < usedBytes; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    codewords[i] = b;
  }

  // Alternating pad bytes 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  for (let i = usedBytes; i < dataCWCount; i++) {
    codewords[i] = padBytes[(i - usedBytes) % 2];
  }

  return codewords;
}

function buildFinalBitStream(dataCodewords, version, ecc) {
  const [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = ECC_TABLES[ecc][version];
  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;

  for (let i = 0; i < g1Blocks; i++) {
    const slice = dataCodewords.subarray(offset, offset + g1Data);
    offset += g1Data;
    dataBlocks.push(slice);
    eccBlocks.push(rsComputeEcc(slice, ecPerBlock));
  }
  for (let i = 0; i < g2Blocks; i++) {
    const slice = dataCodewords.subarray(offset, offset + g2Data);
    offset += g2Data;
    dataBlocks.push(slice);
    eccBlocks.push(rsComputeEcc(slice, ecPerBlock));
  }

  const interleaved = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let col = 0; col < maxDataLen; col++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (col < dataBlocks[b].length) {
        interleaved.push(dataBlocks[b][col]);
      }
    }
  }
  for (let col = 0; col < ecPerBlock; col++) {
    for (let b = 0; b < eccBlocks.length; b++) {
      interleaved.push(eccBlocks[b][col]);
    }
  }

  const bits = [];
  for (let i = 0; i < interleaved.length; i++) {
    appendBits(bits, interleaved[i], 8);
  }
  const rem = REMAINDER_BITS[version] || 0;
  for (let i = 0; i < rem; i++) {
    bits.push(0);
  }
  return bits;
}

function computeFormatBits(ecc, mask) {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | (mask & 0b111);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function createMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function placeFunctionPatterns(version) {
  const size = version * 4 + 17;
  const modules = createMatrix(size);
  const isFunction = createMatrix(size);

  const setFn = (row, col, dark) => {
    if (row >= 0 && row < size && col >= 0 && col < size) {
      modules[row][col] = Boolean(dark);
      isFunction[row][col] = true;
    }
  };

  // Finder patterns + 1-module white separator
  const placeFinder = (top, left) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFn(r, c, inOuter && (onBorder || inCenter));
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFn(6, i, dark);
    setFn(i, 6, dark);
  }

  // Alignment patterns
  const centers = ALIGNMENT_CENTERS[version] || [];
  for (const rCenter of centers) {
    for (const cCenter of centers) {
      // Skip finder overlaps
      const overlapsTopLeft = rCenter <= 8 && cCenter <= 8;
      const overlapsTopRight = rCenter <= 8 && cCenter >= size - 9;
      const overlapsBottomLeft = rCenter >= size - 9 && cCenter <= 8;
      if (overlapsTopLeft || overlapsTopRight || overlapsBottomLeft) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFn(rCenter + dr, cCenter + dc, dist === 0 || dist === 2);
        }
      }
    }
  }

  // Reserve format info cells (written after mask selection)
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFn(8, i, false);
      setFn(i, 8, false);
    }
  }
  for (let i = size - 8; i < size; i++) {
    setFn(8, i, false);
    setFn(i, 8, false);
  }

  // Dark module (always dark)
  setFn(size - 8, 8, true);

  // Version information for version >= 7
  if (version >= 7) {
    const vBits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = Boolean((vBits >>> i) & 1);
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  return { size, modules, isFunction };
}

function writeFormatInfo(modules, ecc, mask) {
  const size = modules.length;
  const format = computeFormatBits(ecc, mask);
  const bit = idx => Boolean((format >>> idx) & 1);

  // Copy 1 around top-left finder
  const coords1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = coords1[i];
    modules[r][c] = bit(14 - i);
  }

  // Copy 2 along bottom-left (bits 14..8) and top-right (bits 7..0)
  for (let i = 0; i < 7; i++) {
    modules[size - 1 - i][8] = bit(14 - i);
  }
  modules[size - 8][8] = true;
  for (let i = 0; i < 8; i++) {
    modules[8][size - 8 + i] = bit(7 - i);
  }
}

function placeDataBits(modules, isFunction, bits) {
  const size = modules.length;
  let bitIdx = 0;
  let upward = true;

  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!isFunction[row][c]) {
          modules[row][c] = bitIdx < bits.length ? Boolean(bits[bitIdx++]) : false;
        }
      }
    }
    upward = !upward;
  }
}

function maskCondition(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(baseModules, isFunction, mask) {
  const size = baseModules.length;
  const masked = createMatrix(size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const flip = !isFunction[r][c] && maskCondition(mask, r, c);
      masked[r][c] = flip ? !baseModules[r][c] : baseModules[r][c];
    }
  }
  return masked;
}

function computePenalty(modules) {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: 5+ consecutive same-colored modules in row or column
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 same-colored blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r][c];
      if (
        color === modules[r][c + 1] &&
        color === modules[r + 1][c] &&
        color === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: Finder-like 1:1:3:1:1 patterns flanked by 4 light modules
  const isPatternA = (get, idx) =>
    get(idx) && !get(idx + 1) && get(idx + 2) && get(idx + 3) && get(idx + 4) && !get(idx + 5) && get(idx + 6) &&
    !get(idx + 7) && !get(idx + 8) && !get(idx + 9) && !get(idx + 10);
  const isPatternB = (get, idx) =>
    !get(idx) && !get(idx + 1) && !get(idx + 2) && !get(idx + 3) &&
    get(idx + 4) && !get(idx + 5) && get(idx + 6) && get(idx + 7) && get(idx + 8) && !get(idx + 9) && get(idx + 10);

  for (let r = 0; r < size; r++) {
    const getRow = idx => modules[r][idx];
    for (let c = 0; c <= size - 11; c++) {
      if (isPatternA(getRow, c) || isPatternB(getRow, c)) penalty += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    const getCol = idx => modules[idx][c];
    for (let r = 0; r <= size - 11; r++) {
      if (isPatternA(getCol, r) || isPatternB(getCol, r)) penalty += 40;
    }
  }

  // Rule 4: Dark/light ratio balance
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) darkCount++;
    }
  }
  const total = size * size;
  const k = Math.floor(Math.abs(darkCount * 20 - total * 10) / total);
  penalty += k * 10;

  return penalty;
}

/**
 * Encodes a UTF-8 string into a QR Code boolean matrix (Versions 1-10, ECC L or M).
 */
export function encodeQrMatrix(text, { ecc = "M" } = {}) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("QR コードにする文字列が空です。");
  }
  const level = String(ecc || "M").toUpperCase();
  if (level !== "L" && level !== "M") {
    throw new Error(`未対応の誤り訂正レベルです: ${ecc}（L または M を指定してください）`);
  }

  const utf8Bytes = new TextEncoder().encode(text);
  const version = selectVersion(utf8Bytes.length, level);
  const dataCodewords = buildDataCodewords(utf8Bytes, version, level);
  const finalBits = buildFinalBitStream(dataCodewords, version, level);
  const { size, modules: baseModules, isFunction } = placeFunctionPatterns(version);
  placeDataBits(baseModules, isFunction, finalBits);

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(baseModules, isFunction, mask);
    writeFormatInfo(candidate, level, mask);
    const penalty = computePenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return {
    version,
    size,
    ecc: level,
    mask: bestMask,
    modules: bestModules,
  };
}

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders an offline SVG QR Code with a white quiet zone suitable for dark and light themes.
 */
export function renderQrSvg(
  text,
  {
    ecc = "M",
    quietZone = 4,
    size = 180,
    darkColor = "#111111",
    lightColor = "#ffffff",
    label = "QR コード",
  } = {},
) {
  const qr = encodeQrMatrix(text, { ecc });
  const margin = Number.isInteger(quietZone) && quietZone >= 0 ? quietZone : 4;
  const px = Number.isFinite(Number(size)) && Number(size) > 0 ? Math.round(Number(size)) : 180;
  const viewSize = qr.size + margin * 2;

  const commands = [];
  for (let r = 0; r < qr.size; r++) {
    const row = qr.modules[r];
    let c = 0;
    while (c < qr.size) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && row[c]) c++;
      const runWidth = c - start;
      commands.push(`M${start + margin} ${r + margin}h${runWidth}v1h-${runWidth}z`);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges" role="img" aria-label="${escapeXmlAttr(label)}">`,
    `<rect width="${viewSize}" height="${viewSize}" fill="${escapeXmlAttr(lightColor)}"/>`,
    `<path d="${commands.join("")}" fill="${escapeXmlAttr(darkColor)}"/>`,
    `</svg>`,
  ].join("");
}

export { computeFormatBits, computeVersionBits };
