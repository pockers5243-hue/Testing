/**
 * Direct Stream Scraper (VidSrc Engine)
 * Path: providers/embedwave.js
 */

const PROVIDER_NAME = "EmbedWave (VidSrc API)";

async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];
  if (!tmdbId) return streams;

  const isTv = mediaType === "tv" || mediaType === "series";
  
  // Alternative open API endpoint that exposes direct player links
  const targetUrl = isTv
    ? `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`
    : `https://vidsrc.cc/v2/embed/movie/${tmdbId}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://vidsrc.cc/"
      }
    });

    if (!response.ok) return streams;

    const htmlText = await response.text();

    // Match stream source URLs
    const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
    const matches = htmlText.match(m3u8Regex) || [];
    const uniqueUrls = [...new Set(matches)];

    uniqueUrls.forEach((streamUrl, idx) => {
      streams.push({
        name: `${PROVIDER_NAME} • Server ${idx + 1}`,
        title: isTv ? `📺 S${season}E${episode}` : `🎬 Movie Stream`,
        url: streamUrl,
        quality: "1080p",
        type: "hls",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": targetUrl
        }
      });
    });
  } catch (err) {
    console.log(`[${PROVIDER_NAME}] Error: ${err.message}`);
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
