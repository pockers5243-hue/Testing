/**
 * Filmu Scraper for Nuvio
 */

const DOMAINS_URL = 'https://raw.githubusercontent.com/sapariyaneel/nuvio-plugin/refs/heads/main/domains.json';
const FALLBACK_API_HOST = 'https://speedracelight.com';
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://embed.filmu.in/',
  'Origin': 'https://embed.filmu.in'
};

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174
];
const MAGIC_BYTES = [0x6d, 0x76, 0x6d, 0x31]; // "mvm1"
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const SEGMENT_SAMPLE_SIZE = 5;

let cachedDomains = null;

// Helper Utilities
async function getDomains() {
  if (cachedDomains) return cachedDomains;
  try {
    const res = await fetch(DOMAINS_URL, { skipSizeCheck: true });
    cachedDomains = await res.json();
  } catch (err) {
    cachedDomains = {};
  }
  return cachedDomains;
}

async function getApiHost() {
  const domains = await getDomains();
  const host = domains.speedracelight || domains.filmu || FALLBACK_API_HOST;
  return host.replace(/\/+$/, '');
}

function isCustomBranch(val) {
  return ((val * (val + 1)) & 1) === 0;
}

function fmix32(h) {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function rotl32(x, r) {
  x = x >>> 0;
  r &= 31;
  if (r === 0) return x >>> 0;
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}

function pureBase64Decode(str) {
  let cleanStr = '';
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (char !== '=' && BASE64_CHARS.indexOf(char) !== -1) {
      cleanStr += char;
    }
  }

  let decoded = '';
  for (let i = 0; i < cleanStr.length; i += 4) {
    const b1 = BASE64_CHARS.indexOf(cleanStr.charAt(i));
    const b2 = BASE64_CHARS.indexOf(cleanStr.charAt(i + 1));
    const b3 = i + 2 < cleanStr.length ? BASE64_CHARS.indexOf(cleanStr.charAt(i + 2)) : -1;
    const b4 = i + 3 < cleanStr.length ? BASE64_CHARS.indexOf(cleanStr.charAt(i + 3)) : -1;

    decoded += String.fromCharCode((b1 << 2) | (b2 >> 4));
    if (b3 !== -1) decoded += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
    if (b4 !== -1) decoded += String.fromCharCode(((b3 & 3) << 6) | b4);
  }
  return decoded;
}

function base64UrlToBytes(str) {
  const normalized = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(4 * Math.ceil(str.length / 4), '=');

  const rawString = typeof atob === 'function' ? atob(normalized) : pureBase64Decode(normalized);
  const bytes = new Uint8Array(rawString.length);
  for (let i = 0; i < rawString.length; i++) {
    bytes[i] = rawString.charCodeAt(i);
  }
  return bytes;
}

function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 0x1000193) >>> 0;
  }
  return fmix32(hash);
}

// Custom Keystream Decryption
function makeKeystreamState(seed, tmdbId) {
  const slots = new Array(61);
  let state = fmix32(fnv1a32(seed) ^ fmix32((tmdbId >>> 0) ^ 0x9e3779b9)) >>> 0;

  for (let i = 0; i < 8; i++) {
    if (isCustomBranch(i)) {
      const idx = state % 61;
      state = rotl32((state + 0x9e3779b9) >>> 0, 7 + (7 & i));
      slots[idx] = (state ^ fmix32(state)) >>> 0;
      state = fmix32((state + idx) >>> 0);
    } else {
      slots[i] = SHA256_CONSTANTS[15 & i];
    }
  }
  return { slots, acc: fmix32(0xa5a5a5a5 ^ state) >>> 0 };
}

function nextKeystreamWord(stateObj, counter) {
  const slots = stateObj.slots;
  const acc = stateObj.acc;
  const slotIdx = acc % 61;
  const mask = slotIdx in slots ? -1 : 0;
  const slotValue = slots[slotIdx] >>> 0;
  const maskedVal = (slotValue ^ (Math.imul(0x9e3779b9, counter + 1) >>> 0)) >>> 0;
  const mixedAcc = ((acc ^ maskedVal) >>> 0) | ((acc & maskedVal & mask) >>> 0);

  const rotVal = (
    rotl32((mixedAcc + acc) >>> 0, 31 & slotIdx) ^
    rotl32(acc, 31 & Math.min(slotIdx, 7))
  ) >>> 0;

  const nextVal = fmix32((rotVal + 0x9e3779b9) >>> 0);
  slots[slotIdx] = nextVal >>> 0;
  stateObj.acc = nextVal;
  return nextVal >>> 0;
}

function generateKeystream(seed, tmdbId, length) {
  const state = makeKeystreamState(seed, tmdbId);
  const keystream = new Uint8Array(length);
  let byteOffset = 0;
  let wordCounter = 0;

  while (byteOffset < length) {
    const word = nextKeystreamWord(state, wordCounter++);
    keystream[byteOffset++] = 255 & word;
    if (byteOffset < length) keystream[byteOffset++] = (word >>> 8) & 255;
    if (byteOffset < length) keystream[byteOffset++] = (word >>> 16) & 255;
    if (byteOffset < length) keystream[byteOffset++] = (word >>> 24) & 255;
  }
  return keystream;
}

function utf8BytesToString(bytes) {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    if (b1 < 128) {
      str += String.fromCharCode(b1);
    } else if ((b1 & 224) === 192) {
      const b2 = bytes[i++];
      str += String.fromCharCode(((b1 & 31) << 6) | (b2 & 63));
    } else if ((b1 & 240) === 224) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      str += String.fromCharCode(((b1 & 15) << 12) | ((b2 & 63) << 6) | (b3 & 63));
    } else if ((b1 & 248) === 240) {
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      const b4 = bytes[i++];
      let codePoint = ((b1 & 7) << 18) | ((b2 & 63) << 12) | ((b3 & 63) << 6) | (b4 & 63);
      codePoint -= 0x10000;
      str += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
    } else {
      str += String.fromCharCode(b1);
    }
  }
  return str;
}

function decryptSourcesPayload(encryptedPayload, seed, tmdbId) {
  const encryptedBytes = base64UrlToBytes(encryptedPayload);
  const keystream = generateKeystream(seed, tmdbId, encryptedBytes.length);
  const decryptedBytes = new Uint8Array(encryptedBytes.length);

  for (let i = 0; i < encryptedBytes.length; i++) {
    decryptedBytes[i] = encryptedBytes[i] ^ keystream[i];
  }

  // Validate header magic bytes ("mvm1")
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (decryptedBytes[i] !== MAGIC_BYTES[i]) {
      throw new Error('decrypt failed: bad seed or tampered payload');
    }
  }

  const payloadData = decryptedBytes.slice(MAGIC_BYTES.length);
  return utf8BytesToString(payloadData);
}

// TMDB & File Helpers
async function getTmdbMeta(tmdbId, type) {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const res = await fetch(url, { skipSizeCheck: true });
  if (!res.ok) return null;

  const data = await res.json();
  const title = mediaType === 'tv' ? data.name : data.title;
  const releaseDate = mediaType === 'tv' ? data.first_air_date : data.release_date;
  const year = releaseDate ? releaseDate.slice(0, 4) : '';
  const imdbId = (data.external_ids && data.external_ids.imdb_id) || data.imdb_id || '';

  return { title, year, imdbId };
}

function qualityRank(qualityStr) {
  if (!qualityStr) return 0;
  if (/4k/i.test(qualityStr)) return 2160;
  const parsed = parseInt(qualityStr, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getRealSegmentSize(url) {
  try {
    const headRes = await fetch(url, { method: 'HEAD', headers: HEADERS, skipSizeCheck: true });
    const length = headRes.headers.get('content-length');
    if (length) return parseInt(length, 10);
  } catch (err) {}

  try {
    const rangeRes = await fetch(url, {
      headers: { ...HEADERS, Range: 'bytes=0-0' },
      skipSizeCheck: true
    });
    const contentRange = rangeRes.headers.get('content-range');
    const match = contentRange && contentRange.match(/\/(\d+)$/);
    if (match) return parseInt(match[1], 10);
  } catch (err) {}

  return null;
}

async function estimateHlsSize(m3u8Url) {
  try {
    const res = await fetch(m3u8Url, { headers: HEADERS, skipSizeCheck: true });
    if (!res.ok) return 'Unknown';

    const text = await res.text();
    const segments = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('http'));

    if (!segments.length) return 'Unknown';

    const sampledSegments = segments
      .filter((_, idx) => idx % Math.max(1, Math.floor(segments.length / SEGMENT_SAMPLE_SIZE)) === 0)
      .slice(0, SEGMENT_SAMPLE_SIZE);

    const sizes = await Promise.all(sampledSegments.map(getRealSegmentSize));
    const validSizes = sizes.filter(size => size && size > 0);

    if (!validSizes.length) return 'Unknown';

    const avgSegmentSize = validSizes.reduce((acc, val) => acc + val, 0) / validSizes.length;
    const estimatedTotalBytes = avgSegmentSize * segments.length;

    return formatBytes(estimatedTotalBytes);
  } catch (err) {
    return 'Unknown';
  }
}

// Primary Scraper Function
async function getStreams(id, type, season, episode) {
  try {
    let tmdbId = id;

    // Resolve IMDB ID to TMDB ID if string starts with "tt"
    if (typeof id === 'string' && id.trim().toLowerCase().startsWith('tt')) {
      const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
      const findRes = await fetch(findUrl, { skipSizeCheck: true });
      const findData = await findRes.json();
      const results = type === 'tv' ? findData.tv_results : findData.movie_results;
      tmdbId = results && results.length ? results[0].id : null;
      if (!tmdbId) return [];
    }

    tmdbId = parseInt(tmdbId, 10);
    if (!tmdbId) return [];

    const metadata = await getTmdbMeta(tmdbId, type);
    if (!metadata || !metadata.title) return [];

    const apiHost = await getApiHost();
    const isTv = type === 'tv';

    // 1. Fetch seed for decryption
    const seedRes = await fetch(`${apiHost}/seed?mediaId=${tmdbId}`, {
      headers: HEADERS,
      skipSizeCheck: true
    });
    if (!seedRes.ok) return [];

    const seedData = await seedRes.json().catch(() => null);
    if (!seedData || !seedData.seed) return [];

    // 2. Query target streams endpoint
    const queryParams = new URLSearchParams({
      title: metadata.title,
      mediaType: isTv ? 'tv' : 'movie',
      year: metadata.year || '',
      episodeId: String(isTv ? episode || 1 : 1),
      seasonId: String(isTv ? season || 1 : 1),
      tmdbId: String(tmdbId),
      imdbId: metadata.imdbId || '',
      enc: '2',
      seed: seedData.seed
    });

    const sourcesRes = await fetch(`${apiHost}/sources?${queryParams.toString()}`, {
      headers: HEADERS,
      skipSizeCheck: true
    });
    if (!sourcesRes.ok) return [];

    const encryptedSourcesText = await sourcesRes.text();

    // 3. Decrypt sources payload
    let parsedSources;
    try {
      const decryptedJsonStr = decryptSourcesPayload(encryptedSourcesText, seedData.seed, tmdbId);
      parsedSources = JSON.parse(decryptedJsonStr);
    } catch (err) {
      console.error('[Filmu] Decryption error:', err.message);
      return [];
    }

    const rawSources = (parsedSources && parsedSources.sources) || [];
    if (!rawSources.length) return [];

    // 4. Parse subtitles
    const subtitles = ((parsedSources && parsedSources.subtitles) || [])
      .filter(sub => sub && sub.url)
      .map(sub => ({
        url: sub.url,
        lang: sub.lang || sub.language || 'Unknown'
      }));

    // 5. Construct Nuvio stream items
    const streamResults = await Promise.all(
      rawSources
        .filter(src => src && src.url)
        .map(async src => {
          const estimatedSize = await estimateHlsSize(src.url);
          return {
            url: src.url,
            quality: src.quality || 'Unknown',
            title: 'Size: ' + (src.quality || 'Unknown'),
            name: 'Filmu',
            size: estimatedSize,
            headers: HEADERS,
            subtitles: subtitles
          };
        })
    );

    // Sort by resolution/quality ranking
    streamResults.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
    return streamResults;

  } catch (err) {
    console.error('[Filmu]', err);
    return [];
  }
}

// Module Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

