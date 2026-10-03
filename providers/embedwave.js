/**
 * EmbedWave Nuvio Provider Script
 * Path: providers/embedwave.js
 */

const PROVIDER_NAME = "EmbedWave";
const BASE_URL = "https://embedwave.cc";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://embedwave.cc/",
  "Origin": "https://embedwave.cc"
};

async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];

  if (!tmdbId) {
    console.log(`[${PROVIDER_NAME}] Error: Missing TMDB ID`);
    return streams;
  }

  const isTv = mediaType === "tv" || mediaType === "series";

  // Build target URL
  let targetUrl = isTv
    ? `${BASE_URL}/embed/tv/${tmdbId}/${season}/${episode}`
    : `${BASE_URL}/embed/movie/${tmdbId}`;

  try {
    console.log(`[${PROVIDER_NAME}] Requesting URL: ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: HEADERS
    });

    if (!response.ok) {
      console.log(`[${PROVIDER_NAME}] HTTP error status: ${response.status}`);
      return streams;
    }

    const htmlText = await response.text();

    // Look for master playlist links or HLS video source manifests
    const hlsRegex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
    const mp4Regex = /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi;

    const matches = [
      ...(htmlText.match(hlsRegex) || []),
      ...(htmlText.match(mp4Regex) || [])
    ];

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
          // CRITICAL: Streams fail with container errors if referer/origin headers are missing on video segments
          headers: {
            "User-Agent": HEADERS["User-Agent"],
            "Referer": targetUrl,
            "Origin": BASE_URL
          }
        });
      });
    } else {
      console.log(`[${PROVIDER_NAME}] No direct video streams found. Source may be protected by JS obfuscation.`);
    }
  } catch (error) {
    console.log(`[${PROVIDER_NAME}] Scraper exception: ${error.message}`);
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
