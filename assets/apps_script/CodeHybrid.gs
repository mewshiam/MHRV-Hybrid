/**
 * MHRV-denuitt1 Hybrid Relay (GAS + CF Worker)
 *
 * Client protocol:
 *   Single: POST { k, m, u, h, b, ct, r }            -> { s, h, b } or { e }
 *   Batch : POST { k, q: [{m,u,h,b,ct,r}, ...] }     -> { q: [{s,h,b}|{e}, ...] }
 *
 * Routing:
 *   - Google domains: direct UrlFetchApp
 *   - Everything else: forward via Cloudflare Worker
 *
 * Notes:
 *   - Keep AUTH_KEY secret and match it in mhrv-rs config.
 *   - Set WORKER_URL to your Cloudflare Worker endpoint.
 */

const AUTH_KEY = "";  // CHANGE THIS
const WORKER_URL = "";  // CHANGE THIS

// Direct routing allowlist (these go direct, everything else goes through CF)
// Add any domains that are NOT blocked in your country
const DIRECT_ALLOWLIST = [
  "google.com",
  "gstatic.com",
  "googleapis.com",
  "googleusercontent.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "googlesyndication.com",
  "withgoogle.com",
  "chrome.com",
  "chromecast.com",
  "chromeos.dev",
  "chromium.org",
  "cookiechoices.org",
  "g-tun.com",
  "g.co",
  "g.dev",
  "g.page",
  "ggoogle.com",
  "gmail.com",
  "goo.gl",
  "google-access.net",
  "google-syndication.com",
  "google.dev",
  "google.net",
  "google.org",
  "googleacquisitionmigration.com",
  "googleapps.com",
  "googlearth.com",
  "googleblog.com",
  "googlebot.com",
  "googlecapital.com",
  "googlecert.net",
  "googlecode.com",
  "googlecommerce.com",
  "googledanmark.com",
  "googledomains.com",
  "googledrive.com",
  "googlee.com",
  "googleearth.com",
  "googlefiber.com",
  "googlefiber.net",
  "googlefinland.com",
  "googlemail.com",
  "googlemaps.com",
  "googlepagecreator.com",
  "googlephotos.com",
  "googleplus.com",
  "googlesource.com",
  "googlestore.com",
  "googlesverige.com",
  "googleusercontent.com",
  "googleventures.com",
  "googlezip.net",
  "gvt0.com",
  "gvt1.com",
  "gvt2.com",
  "gvt3.com",
  "gvt5.com",
  "gvt6.com",
  "gvt7.com",
  "gvt9.com",
  "igoogle.com",
  "xn--9kr7l.com",
  "xn--9trs65b.com",
  "xn--flw351e.com",
  "xn--ggle-55da.com",
  "xn--gogl-0nd52e.com",
  "xn--gogl-1nd42e.com",
  "recaptcha.net",
  "youtubeeducation.com",
  "xn--flw351e.com",
  "floonet.goog",
];

const DIRECT_ALLOWLIST_NORMALIZED = DIRECT_ALLOWLIST.map(function (d) {
  return String(d || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
});

const FORCE_DIRECT = [
  "149.154.160.0/20", // Telegram DC range
  "91.108.4.0/22"     // Telegram range
];

// Detect IP
function _isIPv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// Convert IP to number
function _ipToLong(ip) {
  var parts = ip.split(".");
  return (
    (parseInt(parts[0], 10) << 24) |
    (parseInt(parts[1], 10) << 16) |
    (parseInt(parts[2], 10) << 8) |
    parseInt(parts[3], 10)
  ) >>> 0;
}

// CIDR match
function _ipInCidr(ip, cidr) {
  var parts = cidr.split("/");
  var base = _ipToLong(parts[0]);
  var maskBits = parseInt(parts[1], 10);

  var ipLong = _ipToLong(ip);
  var mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;

  return (ipLong & mask) === (base & mask);
}

// Check Telegram IP ranges
function _isForceDirectIP(host) {
  if (!_isIPv4(host)) return false;

  for (var i = 0; i < FORCE_DIRECT.length; i++) {
    if (_ipInCidr(host, FORCE_DIRECT[i])) {
      return true;
    }
  }
  return false;
}

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
    // Direct route (Google and other allowlisted domains)
    return {
      url: req.u,
      worker: false,
      opts: _buildDirectOpts(req),
    };
  }

  // Cloudflare Worker route (everything else)
  if (!WORKER_URL) {
    throw new Error("WORKER_URL is required");
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

/**
 * Determines whether to use Cloudflare Worker or direct connection
 * 
 * NEW LOGIC:
 * - If host matches DIRECT_ALLOWLIST → direct (return false)
 * - Everything else → Cloudflare Worker (return true)
 */
function _shouldUseWorker(url) {
  var host;
  try {
    host = _hostFromUrl(url).toLowerCase();
  } catch (_) {
    return true; // safer fallback
  }

  // Telegram override
  if (_isForceDirectIP(host)) {
    return false; //force Direct
  }

  // Bypass child protection
  if (host === "www.google.com") {
    return true; // force Worker
  }

  // Suffix match for ALL entries
  for (var i = 0; i < DIRECT_ALLOWLIST_NORMALIZED.length; i++) {
    var suffix = DIRECT_ALLOWLIST_NORMALIZED[i];
    if (!suffix) continue;

    if (host === suffix || host.endsWith("." + suffix)) {
      return false;
    }
  }

  return true; // default → Worker
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
  } catch (_) { }
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
