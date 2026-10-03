/**
 * Direct M3U8 Scraper for EmbedWave
 * Path: providers/embedwave.js
 */

const PROVIDER_NAME = "EmbedWave";
const BASE_URL = "https://embedwave.cc";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": `${BASE_URL}/`,
  "Origin": BASE_URL
};

async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];

  if (!tmdbId) return streams;

  const isTv = mediaType === "tv" || mediaType === "series";
  const targetUrl = isTv
    ? `${BASE_URL}/embed/tv/${tmdbId}/${season}/${episode}`
    : `${BASE_URL}/embed/movie/${tmdbId}`;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: HEADERS
    });

    if (!response.ok) return streams;

    const htmlText = await response.text();

    // Regex strictly targeted at direct m3u8 playlist URLs
    const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
    const matches = htmlText.match(m3u8Regex) || [];
    const uniqueUrls = [...new Set(matches)];

    uniqueUrls.forEach((streamUrl, index) => {
      streams.push({
        name: `${PROVIDER_NAME} • Server ${index + 1}`,
        title: isTv ? `📺 S${season}E${episode}` : `🎬 Movie Stream`,
        url: streamUrl,
        quality: "1080p",
        type: "hls",
        // Stream segments enforce origin/referer checks
        headers: {
          "User-Agent": HEADERS["User-Agent"],
          "Referer": targetUrl,
          "Origin": BASE_URL
        }
      });
    });
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] M3U8 Scrape Error: ${error.message}`);
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
