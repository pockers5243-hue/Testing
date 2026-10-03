/**
 * Filmu Scraper for Nuvio
 * Target Domain: https://embed.filmu.in
 */

const BASE_URL = 'https://embed.filmu.in';
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': `${BASE_URL}/`,
  'Origin': BASE_URL
};

// Converts IMDB ID (tt1234567) to TMDB numeric ID if needed
async function getTmdbIdFromImdb(imdbId, type) {
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const res = await fetch(url, { skipSizeCheck: true });
    if (!res.ok) return null;
    const data = await res.json();
    const results = type === 'tv' ? data.tv_results : data.movie_results;
    return results && results.length ? results[0].id : null;
  } catch (err) {
    return null;
  }
}

// Extracts stream source URLs (.m3u8, .mp4) and subtitle tracks from raw page/script contents
function parseStreamData(content) {
  const streams = [];
  const subtitles = [];

  // Match HLS / M3U8 Master Playlists
  const hlsMatches = content.match(/https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]* /gi) || [];
  hlsMatches.forEach(url => {
    streams.push({
      url: url.trim(),
      quality: 'Auto (HLS)',
      type: 'hls'
    });
  });

  // Match MP4 Sources
  const mp4Matches = content.match(/https?:\/\/[^\s"'<>]+?\.mp4[^\s"'<>]* /gi) || [];
  mp4Matches.forEach(url => {
    streams.push({
      url: url.trim(),
      quality: '1080p',
      type: 'mp4'
    });
  });

  // Match Subtitle Tracks (.vtt / .srt)
  const subMatches = content.match(/https?:\/\/[^\s"'<>]+?\.(vtt|srt)[^\s"'<>]* /gi) || [];
  subMatches.forEach((url, idx) => {
    subtitles.push({
      url: url.trim(),
      lang: `Track ${idx + 1}`
    });
  });

  return { streams, subtitles };
}

// Primary stream handler for Nuvio
async function getStreams(id, type, season, episode) {
  try {
    let tmdbId = id;

    // Convert IMDB ID to TMDB ID if string starts with "tt"
    if (typeof id === 'string' && id.trim().toLowerCase().startsWith('tt')) {
      tmdbId = await getTmdbIdFromImdb(id, type);
      if (!tmdbId) return [];
    }

    tmdbId = parseInt(tmdbId, 10);
    if (!tmdbId) return [];

    const isTv = type === 'tv';
    const embedPath = isTv 
      ? `/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `/embed/movie/${tmdbId}`;

    const embedUrl = `${BASE_URL}${embedPath}`;

    // 1. Fetch the Filmu player embed page
    const response = await fetch(embedUrl, {
      headers: HEADERS,
      skipSizeCheck: true
    });

    if (!response.ok) return [];

    const htmlText = await response.text();
    const { streams, subtitles } = parseStreamData(htmlText);

    // 2. If no direct streams found, check for nested iframe player URLs
    if (!streams.length) {
      const iframeMatches = [...htmlText.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)];
      for (const match of iframeMatches) {
        let subEmbedUrl = match[1];
        if (subEmbedUrl.startsWith('//')) subEmbedUrl = 'https:' + subEmbedUrl;
        if (subEmbedUrl.startsWith('/')) subEmbedUrl = BASE_URL + subEmbedUrl;

        try {
          const subRes = await fetch(subEmbedUrl, { headers: HEADERS, skipSizeCheck: true });
          if (!subRes.ok) continue;

          const subHtml = await subRes.text();
          const subParsed = parseStreamData(subHtml);

          if (subParsed.streams.length) {
            streams.push(...subParsed.streams);
            subtitles.push(...subParsed.subtitles);
          }
        } catch (e) {
          // Skip broken embed mirror
        }
      }
    }

    // 3. Format result objects according to Nuvio standard
    return streams.map(stream => ({
      name: 'Filmu',
      title: `Filmu - ${stream.quality}`,
      url: stream.url,
      quality: stream.quality,
      headers: HEADERS,
      subtitles: subtitles
    }));

  } catch (error) {
    console.error('[Filmu Error]:', error);
    return [];
  }
}

// Module Exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}

