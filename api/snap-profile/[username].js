const https = require("https");

function fetchUrl(url, redirectCount) {
  if (!redirectCount) redirectCount = 0;
  return new Promise(function(resolve) {
    if (redirectCount > 5) return resolve({ status: 0, body: "" });
    var req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
      },
    }, function(res) {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 308) && res.headers.location) {
        var loc = res.headers.location.startsWith("http")
          ? res.headers.location
          : "https://www.snapchat.com" + res.headers.location;
        res.resume();
        return fetchUrl(loc, redirectCount + 1).then(resolve);
      }
      var body = "";
      res.on("data", function(d) { body += d; });
      res.on("end", function() { resolve({ status: res.statusCode || 0, body: body }); });
    });
    req.on("error", function() { resolve({ status: 0, body: "" }); });
    req.setTimeout(12000, function() { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

function buildSnapcodeUrl(username) {
  return "https://app.snapchat.com/web/deeplink/snapcode?username=" + encodeURIComponent(username) + "&type=SVG&bitmoji=enable";
}

function deepFindNumber(obj, keys) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] in obj) {
        var v = obj[keys[i]];
        if (typeof v === "number" && v > 0) return v;
        if (typeof v === "string") { var n = parseInt(v, 10); if (!isNaN(n) && n > 0) return n; }
      }
    }
    var vals = Object.values(obj);
    for (var j = 0; j < vals.length; j++) {
      var found = deepFindNumber(vals[j], keys);
      if (found !== null) return found;
    }
  } else if (Array.isArray(obj)) {
    for (var k = 0; k < obj.length; k++) {
      var found2 = deepFindNumber(obj[k], keys);
      if (found2 !== null) return found2;
    }
  }
  return null;
}

function deepFindString(obj, keys) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] in obj && typeof obj[keys[i]] === "string" && obj[keys[i]].length > 0) return obj[keys[i]];
    }
    var vals = Object.values(obj);
    for (var j = 0; j < vals.length; j++) {
      var found = deepFindString(vals[j], keys);
      if (found !== null) return found;
    }
  } else if (Array.isArray(obj)) {
    for (var k = 0; k < obj.length; k++) {
      var found2 = deepFindString(obj[k], keys);
      if (found2 !== null) return found2;
    }
  }
  return null;
}

function extractProfile(username, html) {
  function meta(patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1]) return m[1];
    }
    return undefined;
  }

  /* ── Parse __NEXT_DATA__ ── */
  var nextData = null;
  var ndMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (ndMatch && ndMatch[1]) {
    try { nextData = JSON.parse(ndMatch[1]); } catch(e) {}
  }

  /* ── displayName ── */
  var displayName;
  if (nextData) {
    var dn = deepFindString(nextData, ["displayName", "display_name"]);
    if (dn && dn.toLowerCase() !== "snapchat" && dn.toLowerCase().indexOf("snapchat") === -1) displayName = dn;
  }
  if (!displayName) displayName = meta([/"displayName"\s*:\s*"((?:[^"\\]|\\.)*)"/]);
  if (!displayName) {
    var og = meta([/property="og:title"\s+content="([^"]+)"/i, /content="([^"]+)"\s+property="og:title"/i]);
    if (og) {
      var cleaned = og.replace(/^Snapchat\s+\S+\s+/u, "").trim();
      if (cleaned && cleaned.toLowerCase() !== "snapchat") displayName = cleaned;
    }
  }
  if (!displayName) displayName = username;

  /* ── bio ── */
  var bio = "";
  if (nextData) {
    var nb = deepFindString(nextData, ["bio", "userBio", "description"]);
    if (nb && nb.length > 0 && nb.length < 500) bio = nb;
  }
  if (!bio) {
    var jsonBioMatch = html.match(/"bio"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    bio = jsonBioMatch && jsonBioMatch[1] ? jsonBioMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() : "";
  }

  /* ── avatarUrl ── */
  var avatarUrl = "";
  if (nextData) {
    avatarUrl = deepFindString(nextData, ["avatarUrl", "avatar_url", "profilePictureUrl"]) || "";
  }
  if (!avatarUrl) {
    avatarUrl = meta([/property="og:image"\s+content="([^"]+)"/i, /content="([^"]+)"\s+property="og:image"/i]) || "";
  }

  /* ── snapcodeUrl ── */
  var snapcodeUrl = buildSnapcodeUrl(username);
  var userInfoRaw = (html.match(/"userInfo"\s*:\s*\{([^}]+)\}/) || [""])[0];
  var scm = userInfoRaw.match(/"snapcodeImageUrl"\s*:\s*"([^"]+)"/);
  if (scm && scm[1]) snapcodeUrl = scm[1].replace(/\\u0026/g, "&");

  /* ── subscriberCount ── */
  var subscriberCount = null;
  if (nextData) {
    subscriberCount = deepFindNumber(nextData, ["subscriberCount", "followerCount", "subscribers", "followers", "SubscriberCount"]);
  }
  if (subscriberCount === null) {
    var subPatterns = [/"subscriberCount"\s*:\s*(\d+)/, /"followerCount"\s*:\s*(\d+)/, /"subscribers"\s*:\s*(\d+)/, /subscriberCount["\s:]+(\d+)/];
    for (var sp = 0; sp < subPatterns.length; sp++) {
      var sm = html.match(subPatterns[sp]);
      if (sm) { subscriberCount = parseInt(sm[1], 10); break; }
    }
  }

  /* ── snapScore ── */
  var snapScore = null;
  if (nextData) {
    snapScore = deepFindNumber(nextData, ["snapScore", "snap_score", "score", "userScore", "SnapScore"]);
  }
  if (snapScore === null) {
    var scorePatterns = [/"snapScore"\s*:\s*(\d+)/, /"snap_score"\s*:\s*(\d+)/, /"userScore"\s*:\s*(\d+)/, /snapScore["\s:]+(\d+)/];
    for (var pp = 0; pp < scorePatterns.length; pp++) {
      var ssm = html.match(scorePatterns[pp]);
      if (ssm) { snapScore = parseInt(ssm[1], 10); break; }
    }
  }

  return { displayName: displayName, bio: bio, avatarUrl: avatarUrl, snapcodeUrl: snapcodeUrl, subscriberCount: subscriberCount, snapScore: snapScore };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  var username = req.query.username || "";
  if (!username || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return res.status(200).json({
      exists: false, username: username || "", displayName: "", bio: "",
      avatarUrl: "", bgUrl: "", snapcodeUrl: "", subscriberCount: null,
      snapScore: null, lastActive: null, stories: [], spotlights: [],
      highlights: [], lenses: [], profileUrl: "",
      error: "المعرف غير صالح — يجب أن يتكون من 3 أحرف على الأقل",
    });
  }
  try {
    var lc = username.toLowerCase();
    var r = await fetchUrl("https://www.snapchat.com/@" + lc);
    if (r.status === 404 || r.status === 0) {
      return res.status(200).json({
        exists: false, username: lc, displayName: lc, bio: "",
        avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(lc),
        subscriberCount: null, snapScore: null, lastActive: null,
        stories: [], spotlights: [], highlights: [], lenses: [],
        profileUrl: "https://www.snapchat.com/@" + lc,
      });
    }
    var profile = extractProfile(lc, r.body);
    return res.status(200).json({
      exists: true, username: lc, displayName: profile.displayName,
      bio: profile.bio, avatarUrl: profile.avatarUrl, bgUrl: "",
      snapcodeUrl: profile.snapcodeUrl, subscriberCount: profile.subscriberCount,
      snapScore: profile.snapScore, lastActive: null, stories: [], spotlights: [],
      highlights: [], lenses: [], profileUrl: "https://www.snapchat.com/@" + lc,
    });
  } catch (err) {
    return res.status(200).json({
      exists: false, username, displayName: username, bio: "",
      avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(username),
      subscriberCount: null, snapScore: null, lastActive: null,
      stories: [], spotlights: [], highlights: [], lenses: [],
      profileUrl: "https://www.snapchat.com/@" + username,
      error: "تعذّر الاتصال بسناب شات. يرجى المحاولة لاحقاً",
    });
  }
};
