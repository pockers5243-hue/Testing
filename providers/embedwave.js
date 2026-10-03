// EmbedWave provider for Nuvio, styled after the vidsrc scraper you sent:
// safeFetch with timeouts, TMDB runtime, rich multi-line stream descriptions.
// Promise-based (no async/await) for Hermes compatibility.

var BASE = 'https://embedwave.cc';
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
var TMDB_API_KEY = ''; // optional: add your own key to show runtime
var MAX_DEPTH = 2;

function log(m) { console.log('[EmbedWave] ' + m); }

function safeFetch(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  var controller = null, timer = null;
  try {
    controller = new AbortController();
    timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  } catch (_) {}
  var opts = Object.assign({ method: 'GET' }, options || {});
  if (controller) opts.signal = controller.signal;
  return fetch(url, opts)
    .then(function (r) { if (timer) clearTimeout(timer); return r; })
    .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
}

function getText(url, referer, timeoutMs) {
  return safeFetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Referer': referer || BASE + '/', 'Accept': '*/*' }
  }, timeoutMs).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.text();
  });
}

function absolute(url, base) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  var m = base.match(/^(https?:\/\/[^\/]+)/i);
  var origin = m ? m[1] : BASE;
  return url.charAt(0) === '/' ? origin + url : base.replace(/[^\/]*$/, '') + url;
}

function clean(html) {
  return html.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

function findStreams(html) {
  var found = clean(html).match(/https?:\/\/[^"'\s<>\\)]+?\.(?:m3u8|mp4)(?:\?[^"'\s<>\\)]*)?/gi) || [];
  var seen = {};
  return found.filter(function (u) { if (seen[u]) return false; seen[u] = 1; return true; });
}

function findIframes(html, base) {
  var re = /<iframe[^>]+src=["']([^"']+)["']/gi, out = [], m, text = clean(html);
  while ((m = re.exec(text)) !== null) out.push(absolute(m[1], base));
  return out;
}

function parseTitle(html) {
  var t = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  t = t.replace(/\s*[-|]\s*EmbedWave.*$/i, '').trim();
  var y = t.match(/\s*\((\d{4})\)$/), year = '';
  if (y) { year = y[1]; t = t.replace(/\s*\(\d{4}\)$/, '').trim(); }
  return { title: t || 'Unknown', year: year };
}

function guessQuality(url) {
  var m = url.match(/(2160|1440|1080|720|480|360)p?/);
  return m ? m[1] + 'p' : '1080p';
}

function extract(url, referer, depth, meta) {
  return getText(url, referer, 8000).then(function (html) {
    if (depth === 0) meta.page = parseTitle(html);
    var streams = findStreams(html);
    if (streams.length) {
      return streams.map(function (s) { return { url: s, referer: url }; });
    }
    if (depth >= MAX_DEPTH) return [];
    return findIframes(html, url).reduce(function (chain, frame) {
      return chain.then(function (acc) {
        if (acc.length) return acc;
        return extract(frame, url, depth + 1, meta).catch(function () { return []; });
      });
    }, Promise.resolve([]));
  });
}

function fetchRuntime(tmdbId, season, episode) {
  var fallback = '45 min';
  if (!TMDB_API_KEY) return Promise.resolve(fallback);
  var base = 'https://api.themoviedb.org/3/tv/' + tmdbId;
  return safeFetch(base + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_API_KEY)
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (e) {
      if (e.runtime) return e.runtime + ' min';
      return safeFetch(base + '?api_key=' + TMDB_API_KEY)
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (d) {
          return d.episode_run_time && d.episode_run_time.length ? d.episode_run_time[0] + ' min' : fallback;
        });
    })
    .catch(function () { return fallback; });
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType === 'series') mediaType = 'tv';
  if (mediaType !== 'tv') { log('Only TV is supported'); return Promise.resolve([]); }

  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var embedUrl = BASE + '/embed/tv/' + tmdbId + '/' + s + '/' + e;
  var meta = { page: { title: 'Unknown', year: '' } };
  log('Fetching ' + embedUrl);

  return Promise.all([
    extract(embedUrl, BASE + '/', 0, meta),
    fetchRuntime(tmdbId, s, e)
  ]).then(function (res) {
    var results = res[0], runtime = res[1];
    if (!results.length) log('No direct m3u8/mp4 found');
    var title = meta.page.title;
    var year = meta.page.year ? ' - (' + meta.page.year + ')' : '';
    var ep = ' S' + pad(s) + 'E' + pad(e);

    var streams = results.map(function (r, i) {
      var quality = guessQuality(r.url);
      var container = /\.m3u8/i.test(r.url) ? 'HLS' : 'MP4';
      var label = 'Server ' + (i + 1);
      var desc =
        '\uD83C\uDFAC ' + title + ep + year + '\n' +
        '\u2B50 ' + quality + ' | \uD83C\uDF0D Original-Audio | \uD83C\uDFA7 AAC\n' +
        '\uD83D\uDCE6 ' + container + ' | \uD83C\uDFA5 x264 | \u23F3 ' + runtime + '\n' +
        '\uD83D\uDCCE ' + label;
      return {
        name: 'EmbedWave | ' + quality.toLowerCase() + ' ',
        title: desc,
        size: desc,
        description: desc,
        url: r.url,
        quality: '',
        language: '',
        headers: { 'User-Agent': USER_AGENT, 'Referer': r.referer, 'Origin': BASE },
        subtitles: [],
        provider: 'embedwave'
      };
    });
    log('Streams found: ' + streams.length);
    return streams;
  }).catch(function (err) {
    log('Scraper error: ' + err.message);
    return [];
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
