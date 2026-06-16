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

function extractProfile(username, html) {
  function meta(patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1]) return m[1];
    }
    return undefined;
  }

  var userInfoRaw = (html.match(/"userInfo"\s*:\s*\{([^}]+)\}/) || [""])[0];

  var displayName = meta([/"displayName"\s*:\s*"((?:[^"\\]|\\.)*)"/]);
  if (!displayName) {
    var og = meta([
      /property="og:title"\s+content="([^"]+)"/i,
      /content="([^"]+)"\s+property="og:title"/i,
    ]);
    if (og) {
      var cleaned = og.replace(/^Snapchat\s+\S+\s+/u, "").trim();
      if (cleaned && cleaned.toLowerCase() !== "snapchat") displayName = cleaned;
    }
  }
  if (!displayName) displayName = username;

  var jsonBioMatch = html.match(/"bio"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  var bio = jsonBioMatch && jsonBioMatch[1]
    ? jsonBioMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim()
    : "";

  var avatarUrl = meta([
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
  ]) || "";

  var snapcodeUrl = buildSnapcodeUrl(username);
  var scm = userInfoRaw.match(/"snapcodeImageUrl"\s*:\s*"([^"]+)"/);
  if (scm && scm[1]) snapcodeUrl = scm[1].replace(/\\u0026/g, "&");

  var subMatch = html.match(/"subscriberCount"\s*:\s*(\d+)/);
  var subscriberCount = subMatch ? parseInt(subMatch[1], 10) : null;

  return { displayName: displayName, bio: bio, avatarUrl: avatarUrl, snapcodeUrl: snapcodeUrl, subscriberCount: subscriberCount };
}

exports.handler = async function(event) {
  var qs = event.queryStringParameters || {};
  var pathParts = (event.path || "").split("/").filter(Boolean);
  var username = qs.username || decodeURIComponent(pathParts[pathParts.length - 1] || "");

  if (!username || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exists: false, username: username || "", displayName: "", bio: "",
        avatarUrl: "", bgUrl: "", snapcodeUrl: "", subscriberCount: null,
        snapScore: null, lastActive: null, stories: [], spotlights: [],
        highlights: [], lenses: [], profileUrl: "",
        error: "المعرف غير صالح — يجب أن يتكون من 3 أحرف على الأقل",
      }),
    };
  }

  try {
    var lc = username.toLowerCase();
    var r = await fetchUrl("https://www.snapchat.com/@" + lc);

    if (r.status === 404 || r.status === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exists: false, username: lc, displayName: lc, bio: "",
          avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(lc),
          subscriberCount: null, snapScore: null, lastActive: null,
          stories: [], spotlights: [], highlights: [], lenses: [],
          profileUrl: "https://www.snapchat.com/@" + lc,
        }),
      };
    }

    var profile = extractProfile(lc, r.body);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exists: true, username: lc,
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        bgUrl: "",
        snapcodeUrl: profile.snapcodeUrl,
        subscriberCount: profile.subscriberCount,
        snapScore: null, lastActive: null,
        stories: [], spotlights: [], highlights: [], lenses: [],
        profileUrl: "https://www.snapchat.com/@" + lc,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exists: false, username: username, displayName: username, bio: "",
        avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(username),
        subscriberCount: null, snapScore: null, lastActive: null,
        stories: [], spotlights: [], highlights: [], lenses: [],
        profileUrl: "https://www.snapchat.com/@" + username,
        error: "تعذّر الاتصال بسناب شات. يرجى المحاولة لاحقاً",
      }),
    };
  }
};
