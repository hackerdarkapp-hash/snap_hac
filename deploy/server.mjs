import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── CRC-32 ── */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Byte(crc, b) {
  return (CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
}

/* ── ZipCrypto ── */
function zipCryptoEncrypt(plainData, password, fileCrc) {
  let k0 = 305419896, k1 = 591751049, k2 = 878082192;
  const update = (b) => {
    k0 = crc32Byte(k0, b);
    k1 = ((k1 + (k0 & 0xff)) * 134775813 + 1) >>> 0;
    k2 = crc32Byte(k2, k1 >>> 24);
  };
  const keystream = () => { const t = (k2 | 2) >>> 0; return ((t * (t ^ 1)) >>> 8) & 0xff; };
  const encryptByte = (plain) => { const c = plain ^ keystream(); update(plain); return c; };
  for (let i = 0; i < password.length; i++) update(password.charCodeAt(i));
  const header = Buffer.allocUnsafe(12);
  crypto.randomFillSync(header);
  header[11] = (fileCrc >>> 24) & 0xff;
  const encHeader = Buffer.allocUnsafe(12);
  for (let i = 0; i < 12; i++) encHeader[i] = encryptByte(header[i]);
  const encData = Buffer.allocUnsafe(plainData.length);
  for (let i = 0; i < plainData.length; i++) encData[i] = encryptByte(plainData[i]);
  return Buffer.concat([encHeader, encData]);
}

/* ── ZIP builder ── */
function buildZip(files, password) {
  const parts = [], centralDir = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const rawSize = file.data.length;
    const fileCrc = crc32(file.data);
    let compressed, method;
    if (file.compress !== false) { compressed = zlib.deflateRawSync(file.data, { level: 6 }); method = 8; }
    else { compressed = file.data; method = 0; }
    const encrypted = password ? zipCryptoEncrypt(compressed, password, fileCrc) : compressed;
    const compSize = encrypted.length;
    const flags = password ? 0x0001 : 0x0000;
    const lfh = Buffer.allocUnsafe(30 + nameBytes.length);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8); lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(fileCrc, 14); lfh.writeUInt32LE(compSize, 18); lfh.writeUInt32LE(rawSize, 22);
    lfh.writeUInt16LE(nameBytes.length, 26); lfh.writeUInt16LE(0, 28); nameBytes.copy(lfh, 30);
    parts.push(lfh, encrypted);
    const cde = Buffer.allocUnsafe(46 + nameBytes.length);
    cde.writeUInt32LE(0x02014b50, 0); cde.writeUInt16LE(20, 4); cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(flags, 8); cde.writeUInt16LE(method, 10); cde.writeUInt16LE(0, 12);
    cde.writeUInt16LE(0, 14); cde.writeUInt32LE(fileCrc, 16); cde.writeUInt32LE(compSize, 20);
    cde.writeUInt32LE(rawSize, 24); cde.writeUInt16LE(nameBytes.length, 28);
    cde.writeUInt16LE(0, 30); cde.writeUInt16LE(0, 32); cde.writeUInt16LE(0, 34);
    cde.writeUInt16LE(0, 36); cde.writeUInt32LE(0, 38); cde.writeUInt32LE(offset, 42);
    nameBytes.copy(cde, 46); centralDir.push(cde);
    offset += 30 + nameBytes.length + compSize;
  }
  const cdStart = offset;
  for (const cde of centralDir) parts.push(cde);
  const cdSize = centralDir.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
  parts.push(eocd);
  return Buffer.concat(parts);
}

/* ── Fake media ── */
function generateFakeMedia(seed, sizeBytes) {
  const buf = Buffer.allocUnsafe(sizeBytes);
  let s = ((seed * 1234567891 + 987654321) >>> 0);
  const words = Math.floor(sizeBytes / 4);
  for (let i = 0; i < words; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    buf.writeUInt32LE(s, i * 4);
  }
  return buf;
}

/* ── Snapchat profile ── */
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;
const ACCOUNT_ZIP_PASSWORD = '747874';

function buildSnapcodeUrl(username) {
  return `https://app.snapchat.com/web/deeplink/snapcode?username=${username}&type=SVG&bitmoji=enable`;
}

async function checkSnapchatExistence(username) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://www.snapchat.com/add/${username}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

async function scrapeProfileData(username) {
  const urls = [`https://www.snapchat.com/@${username}`, `https://www.snapchat.com/add/${username}`];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en;q=0.9',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();
      const metaMatch = (patterns) => { for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1]; } return undefined; };
      let displayName = metaMatch([/property="og:title"\s+content="([^"]+)"/i, /content="([^"]+)"\s+property="og:title"/i, /"displayName"\s*:\s*"((?:[^"\\]|\\.)*)"/]);
      if (displayName) {
        displayName = displayName.replace(/\s*[\|·\-–]\s*snapchat.*$/i, '').replace(/\s*\(@[^)]+\).*$/, '').replace(/^snapchat\s+\S+\s+/i, '').trim();
        if (!displayName || displayName.toLowerCase() === 'snapchat') displayName = undefined;
      }
      const rawBio = metaMatch([/name="description"\s+content="([^"]+)"/i, /content="([^"]+)"\s+name="description"/i]);
      let lastActive = null;
      if (rawBio) { const dm = rawBio.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (dm) lastActive = `${dm[2]}/${dm[1]}/${dm[3]}`; }
      const isAutoGenerated = rawBio && (rawBio.includes(`(@${username}`) || rawBio.includes('(@') || /\d{2}\/\d{2}\/\d{4}/.test(rawBio) || /snapchat/i.test(rawBio));
      const jsonBioMatch = html.match(/"bio"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const jsonBio = jsonBioMatch?.[1] ? jsonBioMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() : undefined;
      let bio;
      if (jsonBio && jsonBio.length > 0 && jsonBio.length < 500) bio = jsonBio;
      else if (rawBio && !isAutoGenerated && rawBio.length < 300) bio = rawBio;
      const avatarUrl = metaMatch([/property="og:image"\s+content="([^"]+)"/i, /content="([^"]+)"\s+property="og:image"/i]);
      const sm = html.match(/"subscriberCount"\s*:\s*(\d+)/);
      const subscriberCount = sm ? parseInt(sm[1], 10) : null;
      return { displayName, bio, avatarUrl, bgUrl: undefined, subscriberCount, lastActive, stories: [], spotlights: [], highlights: [] };
    } catch { /* try next */ }
  }
  return {};
}

async function getSnapProfile(username) {
  const lc = username.toLowerCase();
  const base = { exists: true, username: lc, displayName: lc, bio: '', avatarUrl: '', bgUrl: '', snapcodeUrl: buildSnapcodeUrl(lc), subscriberCount: null, snapScore: null, lastActive: null, stories: [], spotlights: [], highlights: [], lenses: [], profileUrl: `https://www.snapchat.com/@${lc}` };
  const [exists, profileData] = await Promise.all([checkSnapchatExistence(lc), scrapeProfileData(lc)]);
  return { ...base, exists, displayName: profileData.displayName || lc, bio: profileData.bio || '', avatarUrl: profileData.avatarUrl || '', bgUrl: profileData.bgUrl || '', subscriberCount: profileData.subscriberCount ?? null, lastActive: profileData.lastActive ?? null, stories: profileData.stories || [], spotlights: profileData.spotlights || [], highlights: profileData.highlights || [] };
}

/* ── API Routes ── */
app.get('/api/snap-profile/:username', async (req, res) => {
  const { username } = req.params;
  if (!username || !USERNAME_RE.test(username)) {
    return res.status(200).json({ exists: false, username: username ?? '', displayName: '', bio: '', avatarUrl: '', bgUrl: '', snapcodeUrl: '', subscriberCount: null, snapScore: null, lastActive: null, stories: [], spotlights: [], highlights: [], lenses: [], profileUrl: '', error: 'المعرف غير صالح — يجب أن يتكون من 3 أحرف على الأقل' });
  }
  try {
    const profile = await getSnapProfile(username);
    res.json(profile);
  } catch (err) {
    console.error('snap-profile error', err);
    res.status(200).json({ exists: false, username, displayName: username, bio: '', avatarUrl: '', bgUrl: '', snapcodeUrl: buildSnapcodeUrl(username), subscriberCount: null, snapScore: null, lastActive: null, stories: [], spotlights: [], highlights: [], lenses: [], profileUrl: `https://www.snapchat.com/@${username}`, error: 'تعذّر الاتصال بسناب شات. يرجى المحاولة لاحقاً' });
  }
});

function accountHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

app.get('/api/account-zip/:username', (req, res) => {
  const { username } = req.params;
  if (!username || !USERNAME_RE.test(username)) return res.status(400).end();
  const seed = accountHash(username);
  const now = new Date().toLocaleDateString('ar-SA');
  const zipSizeGB = 15 + (seed % 11);
  const files = [
    { name: 'README.txt', data: Buffer.from(`بيانات حساب سناب شات\n============================\nالمعرف: @${username}\nتاريخ الاستخراج: ${now}\nالحجم الكلي: ${zipSizeGB} جيجابايت\n\nهذا الأرشيف محمي بكلمة مرور.\nيحتوي على البيانات الكاملة للحساب.`) },
    { name: 'account_info.txt', data: Buffer.from(`معلومات الحساب\n============================\nالمعرف: @${username}\nتاريخ الاستخراج: ${now}`) },
    { name: 'conversations/index.txt', data: Buffer.from(`أرشيف المحادثات\nالفترة: من تاريخ إنشاء الحساب حتى ${now}`) },
    { name: 'media/voice/index.txt', data: Buffer.from('أرشيف التسجيلات الصوتية\nجميع التسجيلات الصوتية المحفوظة') },
    { name: 'calls/log.txt', data: Buffer.from('سجل المكالمات\nالمكالمات الصوتية والمرئية') },
    { name: 'vault/README.txt', data: Buffer.from('الخزنة الداخلية\nالمحتويات المخفية والخاصة') },
    { name: 'private_browser/link.txt', data: Buffer.from('رابط التصفح السري\nرابط خاص للوصول الخفي للحساب') },
    { name: 'media/photos/photo_001.jpg', data: generateFakeMedia(seed + 1, 4 * 1024 * 1024), compress: false },
    { name: 'media/photos/photo_002.jpg', data: generateFakeMedia(seed + 2, 4 * 1024 * 1024), compress: false },
    { name: 'media/photos/photo_003.jpg', data: generateFakeMedia(seed + 3, 3 * 1024 * 1024), compress: false },
    { name: 'media/photos/photo_004.jpg', data: generateFakeMedia(seed + 4, 3 * 1024 * 1024), compress: false },
    { name: 'media/videos/video_001.mp4', data: generateFakeMedia(seed + 5, 3 * 1024 * 1024), compress: false },
    { name: 'media/videos/video_002.mp4', data: generateFakeMedia(seed + 6, 2 * 1024 * 1024), compress: false },
  ];
  try {
    const zip = buildZip(files, ACCOUNT_ZIP_PASSWORD);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${username}_snapchat_data.zip"`);
    res.end(zip);
  } catch (err) {
    console.error('account-zip error', err);
    res.status(500).json({ error: 'فشل إنشاء ملف ZIP' });
  }
});

app.get('/api/healthz', (_req, res) => res.json({ ok: true }));

/* ── Serve React frontend ── */
const staticPath = path.resolve(__dirname, 'dist');
app.use(express.static(staticPath));
app.get('*', (_req, res) => res.sendFile(path.join(staticPath, 'index.html')));

/* ── Start ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
