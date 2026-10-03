/**
 * EmbedWave Nuvio Provider Script
 * Repository: pockers5243-hue/Testing
 * File: embedwave.js
 */

const PROVIDER_NAME = "EmbedWave";
const BASE_URL = "https://embedwave.cc";

// Standard headers required to bypass basic hotlink protections
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://embedwave.cc/",
  "Origin": "https://embedwave.cc"
};

/**
 * Main stream extraction function invoked by Nuvio
 * @param {string} tmdbId - TMDB ID of the target content
 * @param {string} mediaType - "movie", "tv", or "series"
 * @param {number|string} [season] - Season number (TV shows only)
 * @param {number|string} [episode] - Episode number (TV shows only)
 * @returns {Promise<Array>} Array of stream objects formatted for Nuvio
 */
async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];

  if (!tmdbId) {
    console.log(`[${PROVIDER_NAME}] Error: Missing TMDB ID`);
    return streams;
  }

  const isTv = mediaType === "tv" || mediaType === "series";

  // Build target URL on embedwave.cc based on media type
  let targetUrl = isTv
    ? `${BASE_URL}/embed/tv/${tmdbId}/${season}/${episode}`
    : `${BASE_URL}/embed/movie/${tmdbId}`;

  try {
    console.log(`[${PROVIDER_NAME}] Requesting: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: HEADERS
    });

    if (!response.ok) {
      console.log(`[${PROVIDER_NAME}] Request failed with status: ${response.status}`);
      return streams;
    }

    const htmlText = await response.text();

    // Regex to scan page source for direct .m3u8 (HLS) or .mp4 streams
    const streamUrlRegex = /(https?:\/\/[^\s"']+\.(?:m3u8|mp4)[^\s"']*)/gi;
    const matches = htmlText.match(streamUrlRegex) || [];
    const uniqueUrls = [...new Set(matches)];

    if (uniqueUrls.length > 0) {
      uniqueUrls.forEach((streamUrl, index) => {
        const isHls = streamUrl.includes(".m3u8");

        streams.push({
          name: `${PROVIDER_NAME} • Server ${index + 1}`,
          title: isTv
            ? `📺 Episode S${season}E${episode}`
            : `🎬 Movie Stream`,
          url: streamUrl,
          quality: "1080p",
          type: isHls ? "hls" : "mp4",
          headers: {
            "User-Agent": HEADERS["User-Agent"],
            "Referer": targetUrl
          }
        });
      });
    } else {
      // Fallback: Check for embedded iframe player sources
      const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/i;
      const iframeMatch = htmlText.match(iframeRegex);

      if (iframeMatch && iframeMatch[1]) {
        let embedSrc = iframeMatch[1];
        if (embedSrc.startsWith("//")) {
          embedSrc = "https:" + embedSrc;
        }

        streams.push({
          name: `${PROVIDER_NAME} • Embed Player`,
          title: `🔗 Web Player Stream`,
          url: embedSrc,
          quality: "auto",
          type: "embed",
          headers: {
            "Referer": BASE_URL
          }
        });
      }
    }
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] Scraper error: ${error.message}`);
  }

  return streams;
}

// Module export compatibility for Nuvio build pipeline & Hermes JS runtime
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
