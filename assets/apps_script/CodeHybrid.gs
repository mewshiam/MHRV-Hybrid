/**
 * MHRV Hybrid Relay (Apps Script + optional Cloudflare Worker)
 *
 * Client protocol (same as mhrv-rs):
 *   Single: POST { k, m, u, h, b, ct, r }            -> { s, h, b } or { e }
 *   Batch : POST { k, q: [{m,u,h,b,ct,r}, ...] }     -> { q: [{s,h,b}|{e}, ...] }
 *
 * Routing:
 *   - Default: direct UrlFetchApp to destination URL
 *   - Optional CFW path: for hostnames listed in CFW_HOSTS, forward via WORKER_URL
 *
 * Notes:
 *   - Keep AUTH_KEY secret and match it in mhrv-rs config.
 *   - If WORKER_URL is empty, CFW route is effectively disabled.
 */

const AUTH_KEY = "CHANGE_ME_TO_A_STRONG_SECRET";

// Optional Cloudflare Worker endpoint (ex: "https://myrelay.workers.dev")
const WORKER_URL = "";

// Optional host routing list for worker path.
// Exact host: "x.com"
// Suffix   : ".twitter.com" (matches api.twitter.com)
const CFW_HOSTS = [
  // "x.com",
  // ".twitter.com",
];

const SKIP_HEADERS = {
  host: 1,
  connection: 1,
  "content-length": 1,
  "transfer-encoding": 1,
  "proxy-connection": 1,
  "proxy-authorization": 1,
  "priority": 1,
  te: 1,
};

const DECOY_HTML =
  '<!DOCTYPE html><html><head><title>Web App</title></head>' +
  '<body><p>The script completed but did not return anything.</p></body></html>';

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.k !== AUTH_KEY) return _decoy();

    if (Array.isArray(req.q)) return _doBatch(req.q);
    return _doSingle(req);
  } catch (err) {
    return _decoy();
  }
}

function doGet(e) {
  return ContentService.createTextOutput(DECOY_HTML).setMimeType(ContentService.MimeType.HTML);
}

function _doSingle(req) {
  if (!_isValidUrl(req.u)) return _json({ e: "bad url" });

  try {
    var resp = _fetchRelay(req);
    return _json(_packResponse(resp));
  } catch (err) {
    return _json({ e: String(err) });
  }
}

function _doBatch(items) {
  var fetchArgs = [];
  var indexMap = [];
  var results = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!_isValidUrl(item.u)) {
      results[i] = { e: "bad url" };
      continue;
    }

    var built = _buildFetch(item);
    fetchArgs.push(built.opts);
    indexMap.push({ idx: i, worker: built.worker });
  }

  if (fetchArgs.length > 0) {
    var responses = UrlFetchApp.fetchAll(fetchArgs);
    for (var j = 0; j < responses.length; j++) {
      var meta = indexMap[j];
      try {
        if (meta.worker) {
          results[meta.idx] = JSON.parse(responses[j].getContentText());
        } else {
          results[meta.idx] = _packResponse(responses[j]);
        }
      } catch (err) {
        results[meta.idx] = { e: "invalid worker response" };
      }
    }
  }

  for (var k = 0; k < items.length; k++) {
    if (!results[k]) results[k] = { e: "unknown" };
  }

  return _json({ q: results });
}

function _fetchRelay(req) {
  var built = _buildFetch(req);
  var resp = UrlFetchApp.fetch(built.url, built.opts);
  if (!built.worker) return resp;

  var txt = resp.getContentText();
  return {
    _worker: true,
    _parsed: JSON.parse(txt),
  };
}

function _packResponse(resp) {
  if (resp && resp._worker) return resp._parsed;
  return {
    s: resp.getResponseCode(),
    h: _respHeaders(resp),
    b: Utilities.base64Encode(resp.getContent()),
  };
}

function _buildFetch(req) {
  var useWorker = _shouldUseWorker(req.u);
  if (!useWorker) {
    return {
      url: req.u,
      worker: false,
      opts: _buildDirectOpts(req),
    };
  }

  if (!WORKER_URL) {
    throw new Error("WORKER_URL is empty but request matched CFW_HOSTS");
  }

  return {
    url: WORKER_URL,
    worker: true,
    opts: {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(_buildWorkerPayload(req)),
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      escaping: false,
    },
  };
}

function _buildDirectOpts(req) {
  var opts = {
    method: (req.m || "GET").toLowerCase(),
    muteHttpExceptions: true,
    followRedirects: req.r !== false,
    validateHttpsCertificates: true,
    escaping: false,
  };
  var headers = _filteredHeaders(req.h);
  if (Object.keys(headers).length > 0) opts.headers = headers;
  if (req.b) {
    opts.payload = Utilities.base64Decode(req.b);
    if (req.ct) opts.contentType = req.ct;
  }
  return opts;
}

function _buildWorkerPayload(req) {
  return {
    u: req.u,
    m: (req.m || "GET").toUpperCase(),
    h: _filteredHeaders(req.h),
    b: req.b || null,
    ct: req.ct || null,
    r: req.r !== false,
  };
}

function _filteredHeaders(inHeaders) {
  var headers = {};
  if (!inHeaders || typeof inHeaders !== "object") return headers;

  for (var k in inHeaders) {
    if (!inHeaders.hasOwnProperty(k)) continue;
    if (SKIP_HEADERS[k.toLowerCase()]) continue;
    headers[k] = inHeaders[k];
  }
  return headers;
}

function _shouldUseWorker(url) {
  if (!CFW_HOSTS || CFW_HOSTS.length === 0) return false;

  var host;
  try {
    host = _hostFromUrl(url);
  } catch (_) {
    return false;
  }

  for (var i = 0; i < CFW_HOSTS.length; i++) {
    var entry = String(CFW_HOSTS[i] || "").trim().toLowerCase().replace(/\.+$/, "");
    if (!entry) continue;
    if (entry.charAt(0) === ".") {
      var suffix = entry.slice(1);
      if (!suffix) continue;
      if (host === suffix || host.endsWith("." + suffix)) return true;
    } else {
      if (host === entry) return true;
    }
  }
  return false;
}

function _hostFromUrl(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/]+)/i);
  if (!m) throw new Error("invalid url");
  var authority = m[1].toLowerCase();
  var noAuth = authority.indexOf("@") >= 0 ? authority.split("@").pop() : authority;
  if (noAuth.charAt(0) === "[") {
    var r = noAuth.indexOf("]");
    return (r > 0 ? noAuth.slice(1, r) : noAuth).replace(/\.+$/, "");
  }
  return noAuth.split(":")[0].replace(/\.+$/, "");
}

function _isValidUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function _respHeaders(resp) {
  try {
    if (typeof resp.getAllHeaders === "function") {
      return resp.getAllHeaders();
    }
  } catch (_) {}
  return resp.getHeaders();
}

function _decoy() {
  return ContentService.createTextOutput(DECOY_HTML).setMimeType(ContentService.MimeType.HTML);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
