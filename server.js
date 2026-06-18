const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const STATIC = path.join(__dirname, "artifacts/snapchat-clone/dist/public");

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
  var m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function snapPageType(nd) {
  // Snapchat nests pageProps twice: props.pageProps.pageProps
  try {
    var pp = nd.props.pageProps.pageProps;
    if (pp && pp.pageMetadata && pp.pageMetadata.pageType) return pp.pageMetadata.pageType;
    // Fallback single nesting
    var pp2 = nd.props.pageProps;
    if (pp2 && pp2.pageMetadata && pp2.pageMetadata.pageType) return pp2.pageMetadata.pageType;
  } catch (e) {}
  return null;
}

function snapUserInfo(nd) {
  try {
    var pp = nd.props.pageProps.pageProps;
    return pp.userInfo || pp.userData || pp.user || pp.profileData || null;
  } catch (e) { return null; }
}

function buildSnapcodeUrl(u) {
  return "https://app.snapchat.com/web/deeplink/snapcode?username=" + encodeURIComponent(u) + "&type=SVG&bitmoji=enable";
}

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
    // Use /@ URL (canonical Snapchat profile page)
    var r = await fetchUrl("https://www.snapchat.com/@" + lc);
    if (r.status === 0) return Object.assign(empty, { error: "تعذّر الاتصال بسناب شات" });

    var nd = parseNextData(r.body);
    if (!nd) {
      // No NEXT_DATA at all - can't determine
      return Object.assign(empty, { error: "لم يتم التعرف على الصفحة" });
    }

    var pageType = snapPageType(nd);
    // NOT_FOUND means user doesn't exist
    if (!pageType || pageType === "NOT_FOUND") {
      return empty;
    }

    // User exists - extract info
    var ui = snapUserInfo(nd);
    var displayName = (ui && (ui.displayName || ui.display_name)) || lc;
    var bio = (ui && ui.bio) || "";
    var avatarUrl = (ui && (ui.snapchatAvatarImage || ui.bitmoji3dUrl || ui.avatarUrl || ui.profileImageUrl)) || "";
    var snapcodeUrl = (ui && ui.snapcodeImageUrl) ? ui.snapcodeImageUrl.replace(/\\u0026/g, "&") : buildSnapcodeUrl(lc);
    var subscriberCount = (ui && (ui.subscriberCount || ui.followerCount)) || null;

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
  const seed=accountHash(username),now=new Date().toLocaleDateString("ar-SA"),gb=15+(seed%11);
  const files=[
    {name:"README.txt",data:Buffer.from("بيانات حساب سناب شات\n============================\nالمعرف: @"+username+"\nتاريخ الاستخراج: "+now+"\nالحجم الكلي: "+gb+" جيجابايت\n\nهذا الأرشيف محمي بكلمة مرور.")},
    {name:"account_info.txt",data:Buffer.from("معلومات الحساب\n============================\nالمعرف: @"+username+"\nتاريخ الاستخراج: "+now)},
    {name:"conversations/index.txt",data:Buffer.from("أرشيف المحادثات\nالفترة: من تاريخ إنشاء الحساب حتى "+now)},
    {name:"media/voice/index.txt",data:Buffer.from("أرشيف التسجيلات الصوتية")},
    {name:"calls/log.txt",data:Buffer.from("سجل المكالمات الصوتية والمرئية")},
    {name:"vault/README.txt",data:Buffer.from("الخزنة الداخلية\nالمحتويات المخفية والخاصة")},
    {name:"private_browser/link.txt",data:Buffer.from("رابط التصفح السري")},
    {name:"media/photos/photo_001.jpg",data:genMedia(seed+1,4*1024*1024),compress:false},
    {name:"media/photos/photo_002.jpg",data:genMedia(seed+2,4*1024*1024),compress:false},
    {name:"media/photos/photo_003.jpg",data:genMedia(seed+3,3*1024*1024),compress:false},
    {name:"media/videos/video_001.mp4",data:genMedia(seed+5,3*1024*1024),compress:false},
  ];
  return buildZip(files,"12521252");
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

  // Root → index.html
  if (urlPath === "/" || urlPath === "") { serveIndex(res); return; }

  // Static files
  var filePath = path.join(STATIC, urlPath);
  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC)) { serveIndex(res); return; }
  serveStatic(res, filePath);

}).listen(PORT, function () {
  console.log("Server running on port " + PORT);
});
