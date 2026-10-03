// Deobfuscated Vidlink stream provider.
// String table decoded by running the original decoder; variable names are inferred.

const VIDLINK_API = "https://vidcore.org";
const DECRYPT_API = "https://enc-dec.app/api";
const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706"; // hardcoded in the original

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Connection: "keep-alive",
  Referer: VIDLINK_API + "/",
  Origin: VIDLINK_API,
};

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "Variable Size";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(2) + " " + units[i];
}

// Fake file-size estimate: assumed bitrate (kbps) * jitter * duration.
function calculateCalculatedFallbackSize(quality, durationStr) {
  const minutes = parseInt(durationStr) || 90;
  const q = String(quality || "").toLowerCase();

  let kbps = 5200; // default / 1080p
  if (q.includes("4k") || q.includes("2160")) kbps = 16000;
  else if (q.includes("1080") || q.includes("fhd")) kbps = 5200;
  else if (q.includes("720") || q.includes("hd")) kbps = 2500;
  else if (q.includes("480") || q.includes("sd")) kbps = 1200;

  const jitter = 0.94 + (minutes % 9) / 100;
  const bytes = (kbps * jitter * 1000) / 8 * (minutes * 60);
  return formatBytes(bytes);
}

async function getTmdbMetadata(tmdbId, mediaType, season, episode) {
  let name = "Unknown Title";
  let duration = mediaType === "tv" ? "45 min" : "90 min";

  try {
    const type = mediaType === "movie" ? "movie" : "tv";
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return { name, year: "N/A", duration };
    const data = await res.json();

    if (mediaType === "movie" && data.runtime) {
      duration = data.runtime + " min";
    } else if (mediaType === "tv") {
      const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epRes = await fetch(epUrl);
      if (epRes.ok) {
        const ep = await epRes.json();
        if (ep.runtime) duration = ep.runtime + " min";
        else if (data.episode_run_time && data.episode_run_time.length > 0)
          duration = data.episode_run_time[0] + " min";
      }
    }

    return {
      name: data.title || data.name || name,
      year: (data.release_date || data.first_air_date || "").split("-")[0] || "N/A",
      duration,
    };
  } catch (e) {
    return { name, year: "N/A", duration };
  }
}

// Parse an HLS master playlist and return variants of 720p and above.
async function generateM3u8(masterUrl, headers = {}) {
  try {
    console.log("[M3U8] Parsing master m3u8: " + masterUrl);
    const res = await fetch(masterUrl, { headers });
    const text = await res.text();
    const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/")) + "/";

    const variants = [];
    const re = /#EXT-X-STREAM-INF:.*?RESOLUTION=(\d+x\d+).*?\n([^\n]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const height = parseInt(m[1].split("x")[1]);
      if (height < 720) continue;

      const quality = height + "p";
      let url = m[2].trim();
      if (!url.startsWith("http")) {
        if (url.startsWith("/")) url = new URL(masterUrl).origin + url;
        else url = baseUrl + url;
      }
      variants.push({ quality, url });
    }
    return variants;
  } catch (e) {
    console.warn("[M3U8] Error parsing M3U8, returning empty.", e);
    return [];
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[Vidlink] Fetching streams for " + mediaType + " " + tmdbId);
  try {
    // 1. Get the "encrypted" ID from the third-party enc-dec service.
    const encRes = await fetch(DECRYPT_API + "/enc-vidlink?text=" + tmdbId);
    const encData = await encRes.json();
    const encId = encData.result;
    if (!encId) {
      console.log("[Vidlink] No encrypted ID returned");
      return [];
    }

    const isMovie = mediaType !== "tv" && season == null;
    const meta = await getTmdbMetadata(tmdbId, isMovie ? "movie" : "tv", season, episode);

    // 2. Ask vidlink for the playlist.
    const apiUrl = isMovie
      ? VIDLINK_API + "/api/b/movie/" + encId
      : VIDLINK_API + "/api/b/tv/" + encId + "/" + season + "/" + episode;
    console.log("[Vidlink] Fetching playlist from: " + apiUrl);

    const res = await fetch(apiUrl, { headers: HEADERS });
    const data = await res.json();
    const playlist = data && data.stream && data.stream.playlist;
    if (!playlist) {
      console.log("[Vidlink] No playlist in response");
      return [];
    }

    const streams = [];

    const addStream = (qualityLabel, url) => {
      let displayName = "1080p FHD";
      let res = "1080P";
      const q = String(qualityLabel).toLowerCase();

      if (q.includes("2160") || q.includes("4k")) {
        displayName = "4K UHD";
        res = "2160P";
      } else if (q.includes("1080")) {
        displayName = "1080p FHD";
        res = "1080P";
      } else if (q.includes("720")) {
        displayName = "720p HD";
        res = "720P";
      } else if (q.includes("auto")) {
        displayName = "Auto Dynamic";
        res = "Auto";
      }

      const size = calculateCalculatedFallbackSize(res, meta.duration);
      const title = meta.name + (!isMovie ? " S" + season + "E" + episode : "");

      streams.push({
        name: "VidLink | " + displayName + " | Main Mirror",
        title:
          "🎬 " + title + " - " + meta.year +
          "\n⚡ " + res +
          " | 🌍 Original | 💾 " + size +
          "\n🎞️ M3U8 | ⏱️ " + meta.duration + " | 📌 Main Mirror",
        url,
        quality: qualityLabel,
        type: "m3u8",
        headers: {
          "User-Agent": HEADERS["User-Agent"],
          Referer: VIDLINK_API + "/",
          Origin: VIDLINK_API,
        },
        provider: "vidlink",
      });
    };

    // Master playlist as an "Auto" entry
    addStream("Auto", playlist);

    // Individual variants (>= 720p)
    try {
      const variants = await generateM3u8(playlist, {
        Referer: VIDLINK_API + "/",
        "User-Agent": HEADERS["User-Agent"],
      });
      variants.forEach((v) => addStream(v.quality, v.url));
    } catch (e) {
      console.warn("[Vidlink] Failed to parse extra qualities for " + playlist);
    }

    console.log("[Vidlink] Found playlist stream");
    return streams.map((s) => ({ ...s, quality: getSortedQuality(s.quality) }));
  } catch (e) {
    console.error("[Vidlink] Error: " + e.message);
    return [];
  }
}

// Prepends zero-width spaces so a plain string sort puts higher qualities first.
function getSortedQuality(quality) {
  if (!quality) return "Auto";
  const q = quality.toLowerCase();
  const ZWSP = "\u200b";

  if (q.includes("auto")) return "Auto";
  if (q.includes("2160") || q.includes("4k") || q.includes("uhd")) return ZWSP.repeat(1) + quality;
  if (q.includes("1080") || q.includes("fhd")) return ZWSP.repeat(2) + quality;
  if (q.includes("720") || q.includes("hd")) return ZWSP.repeat(3) + quality;
  if (q.includes("480") || q.includes("sd")) return ZWSP.repeat(4) + quality;
  if (q.includes("360")) return ZWSP.repeat(5) + quality;
  return ZWSP.repeat(4) + quality;
}

module.exports = { getStreams };
