/**
 * EmbedWave Dynamic Stream Scraper
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
    // Step 1: Fetch the initial outer embed page
    const outerResp = await fetch(targetUrl, { headers: HEADERS });
    if (!outerResp.ok) return streams;
    const outerHtml = await outerResp.text();

    // Look for direct .m3u8 links first
    let m3u8Matches = outerHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi) || [];

    // Step 2: If no direct m3u8, extract the nested iframe/player source URL
    if (m3u8Matches.length === 0) {
      const iframeMatch = outerHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
                          outerHtml.match(/src\s*:\s*["']([^"']+)["']/i);

      if (iframeMatch && iframeMatch[1]) {
        let playerUrl = iframeMatch[1];
        if (playerUrl.startsWith("//")) playerUrl = `https:${playerUrl}`;
        else if (playerUrl.startsWith("/")) playerUrl = `${BASE_URL}${playerUrl}`;

        // Step 3: Fetch the internal player frame page
        const playerResp = await fetch(playerUrl, {
          headers: {
            ...HEADERS,
            "Referer": targetUrl
          }
        });

        if (playerResp.ok) {
          const playerHtml = await playerResp.text();

          // Search player frame HTML for .m3u8 or source configurations
          const innerMatches = playerHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi) || [];
          m3u8Matches = [...innerMatches];

          // Search for JS object file properties (e.g. file: "https://...")
          const filePropMatch = playerHtml.match(/file\s*:\s*["']([^"']+)["']/i);
          if (filePropMatch && filePropMatch[1]) {
            m3u8Matches.push(filePropMatch[1]);
          }
        }
      }
    }

    // Step 4: Build Nuvio stream items
    const uniqueUrls = [...new Set(m3u8Matches)];
    uniqueUrls.forEach((streamUrl, idx) => {
      let finalUrl = streamUrl;
      if (finalUrl.startsWith("//")) finalUrl = `https:${finalUrl}`;

      streams.push({
        name: `${PROVIDER_NAME} • Direct HLS`,
        title: isTv ? `📺 S${season}E${episode}` : `🎬 Movie Stream`,
        url: finalUrl,
        quality: "1080p",
        type: "hls",
        headers: {
          "User-Agent": HEADERS["User-Agent"],
          "Referer": targetUrl,
          "Origin": BASE_URL
        }
      });
    });

  } catch (err) {
    console.log(`[${PROVIDER_NAME}] Fetch error: ${err.message}`);
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  globalThis.getStreams = getStreams;
}
