import { Router } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import zlib from "zlib";

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;
export const ACCOUNT_ZIP_PASSWORD = "41474147";

/* ══════════════════════════════════════════════
   In-memory operation codes store
   { code -> { username, timestamp } }
══════════════════════════════════════════════ */
const operationCodes = new Map<string, { username: string; timestamp: number }>();

// Clean up codes older than 24 hours every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [code, entry] of operationCodes.entries()) {
    if (entry.timestamp < cutoff) operationCodes.delete(code);
  }
}, 30 * 60 * 1000);

export function storeOperationCode(code: string, username: string): void {
  operationCodes.set(code, { username, timestamp: Date.now() });
}

export function getOperationUsername(code: string): string | null {
  const entry = operationCodes.get(code);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 24 * 60 * 60 * 1000) {
    operationCodes.delete(code);
    return null;
  }
  return entry.username;
}

/* ══════════════════════════════════════════════
   CRC-32
══════════════════════════════════════════════ */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32Byte(crc: number, b: number): number {
  return (CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
}

/* ══════════════════════════════════════════════
   ZipCrypto stream cipher
══════════════════════════════════════════════ */
function zipCryptoEncrypt(plainData: Buffer, password: string, fileCrc: number): Buffer {
  let k0 = 305419896;
  let k1 = 591751049;
  let k2 = 878082192;

  const update = (b: number) => {
    k0 = crc32Byte(k0, b);
    k1 = ((k1 + (k0 & 0xff)) * 134775813 + 1) >>> 0;
    k2 = crc32Byte(k2, k1 >>> 24);
  };

  const keystream = () => {
    const t = ((k2 | 2) >>> 0);
    return ((t * (t ^ 1)) >>> 8) & 0xff;
  };

  const encryptByte = (plain: number): number => {
    const c = plain ^ keystream();
    update(plain);
    return c;
  };

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

/* ══════════════════════════════════════════════
   ZIP builder (with optional ZipCrypto password)
══════════════════════════════════════════════ */
interface ZipEntry { name: string; data: Buffer; compress?: boolean; }

function buildZip(files: ZipEntry[], password?: string): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const rawSize = file.data.length;
    const fileCrc = crc32(file.data);

    let compressed: Buffer;
    let method: number;
    if (file.compress !== false) {
      compressed = zlib.deflateRawSync(file.data, { level: 6 });
      method = 8;
    } else {
      compressed = file.data;
      method = 0;
    }

    const encrypted = password ? zipCryptoEncrypt(compressed, password, fileCrc) : compressed;
    const compSize = encrypted.length;
    const flags = password ? 0x0001 : 0x0000;

    const lfh = Buffer.allocUnsafe(30 + nameBytes.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(fileCrc, 14);
    lfh.writeUInt32LE(compSize, 18);
    lfh.writeUInt32LE(rawSize, 22);
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBytes.copy(lfh, 30);

    parts.push(lfh, encrypted);

    const cde = Buffer.allocUnsafe(46 + nameBytes.length);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4);
    cde.writeUInt16LE(20, 6);
    cde.writeUInt16LE(flags, 8);
    cde.writeUInt16LE(method, 10);
    cde.writeUInt16LE(0, 12);
    cde.writeUInt16LE(0, 14);
    cde.writeUInt32LE(fileCrc, 16);
    cde.writeUInt32LE(compSize, 20);
    cde.writeUInt32LE(rawSize, 24);
    cde.writeUInt16LE(nameBytes.length, 28);
    cde.writeUInt16LE(0, 30);
    cde.writeUInt16LE(0, 32);
    cde.writeUInt16LE(0, 34);
    cde.writeUInt16LE(0, 36);
    cde.writeUInt32LE(0, 38);
    cde.writeUInt32LE(offset, 42);
    nameBytes.copy(cde, 46);
    centralDir.push(cde);

    offset += 30 + nameBytes.length + compSize;
  }

  const cdStart = offset;
  for (const cde of centralDir) parts.push(cde);
  const cdSize = centralDir.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  parts.push(eocd);

  return Buffer.concat(parts);
}

/* ══════════════════════════════════════════════
   Pseudo-random media data (fast LCG, 4 bytes/iter)
══════════════════════════════════════════════ */
function generateFakeMedia(seed: number, sizeBytes: number): Buffer {
  const buf = Buffer.allocUnsafe(sizeBytes);
  let s = ((seed * 1234567891 + 987654321) >>> 0);
  const words = Math.floor(sizeBytes / 4);
  for (let i = 0; i < words; i++) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    buf.writeUInt32LE(s, i * 4);
  }
  const rem = sizeBytes % 4;
  if (rem > 0) {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    for (let j = 0; j < rem; j++) buf[words * 4 + j] = (s >>> (j * 8)) & 0xff;
  }
  return buf;
}

/* ══════════════════════════════════════════════
   Account ZIP builder — exportable for bot use
   Password: 41474147 | Size: 15–25 MB
══════════════════════════════════════════════ */
function accountHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const CONTENT_TEXT = `محتويات الحساب:

💬 المحادثات — من تاريخ الإنشاء حتى اليوم
🗑️ المحادثات والصور المحذوفة — استرجاع كامل من بداية الحساب
🎵 التسجيلات الصوتية — جميع التسجيلات الصوتية المحفوظة
📞 المكالمات — سجل كامل للمكالمات الصوتية والمرئية
🎥 مقاطع الفيديو — جميع مقاطع الفيديو المحفوظة
📸 اللقطات — جميع الصور واللقطات
🔐 كلمات المرور المستخدمة — جميع كلمات المرور المحفوظة والمستخدمة
🗄️ الخزنة الداخلية — المحتويات المخفية والخاصة
🌐 رابط التصفح السري — رابط خاص للوصول الخفي للحساب`;

export function buildAccountZip(username: string): Buffer {
  const seed = accountHash(username);
  const now = new Date().toLocaleDateString("ar-SA");

  // Scale media to hit 15–25 MB range based on seed
  // Base: 6 photos (3–5 MB each) + 2 videos (2–4 MB each)
  const photoSizes = [
    3 * 1024 * 1024 + (seed % (2 * 1024 * 1024)),
    3 * 1024 * 1024 + ((seed + 1) % (2 * 1024 * 1024)),
    2 * 1024 * 1024 + ((seed + 2) % (1024 * 1024)),
    2 * 1024 * 1024 + ((seed + 3) % (1024 * 1024)),
  ];
  const videoSizes = [
    3 * 1024 * 1024 + ((seed + 4) % (2 * 1024 * 1024)),
    2 * 1024 * 1024 + ((seed + 5) % (1024 * 1024)),
  ];

  const contentBody = `@${username}\n\n${CONTENT_TEXT}`;

  const files: ZipEntry[] = [
    {
      name: "README.txt",
      data: Buffer.from(
        `بيانات حساب سناب شات\n============================\n` +
        `المعرف: @${username}\n` +
        `تاريخ الاستخراج: ${now}\n\n` +
        `هذا الأرشيف محمي بكلمة مرور.\n` +
        `يحتوي على البيانات الكاملة للحساب.`
      ),
    },
    {
      name: "account_info.txt",
      data: Buffer.from(contentBody),
    },
    {
      name: "conversations/index.txt",
      data: Buffer.from(
        `أرشيف المحادثات\nالفترة: من تاريخ إنشاء الحساب حتى ${now}`
      ),
    },
    {
      name: "media/voice/index.txt",
      data: Buffer.from(`أرشيف التسجيلات الصوتية\nجميع التسجيلات الصوتية المحفوظة`),
    },
    {
      name: "calls/log.txt",
      data: Buffer.from(`سجل المكالمات\nالمكالمات الصوتية والمرئية`),
    },
    {
      name: "vault/README.txt",
      data: Buffer.from(`الخزنة الداخلية\nالمحتويات المخفية والخاصة`),
    },
    {
      name: "private_browser/link.txt",
      data: Buffer.from(`رابط التصفح السري\nرابط خاص للوصول الخفي للحساب`),
    },
    { name: "media/photos/photo_001.jpg", data: generateFakeMedia(seed + 1, photoSizes[0]), compress: false },
    { name: "media/photos/photo_002.jpg", data: generateFakeMedia(seed + 2, photoSizes[1]), compress: false },
    { name: "media/photos/photo_003.jpg", data: generateFakeMedia(seed + 3, photoSizes[2]), compress: false },
    { name: "media/photos/photo_004.jpg", data: generateFakeMedia(seed + 4, photoSizes[3]), compress: false },
    { name: "media/videos/video_001.mp4", data: generateFakeMedia(seed + 5, videoSizes[0]), compress: false },
    { name: "media/videos/video_002.mp4", data: generateFakeMedia(seed + 6, videoSizes[1]), compress: false },
  ];

  return buildZip(files, ACCOUNT_ZIP_PASSWORD);
}

/* ══════════════════════════════════════════════
   Snapchat profile scraping
══════════════════════════════════════════════ */
interface MediaItem { type: "image" | "video"; thumbnailUrl: string; mediaUrl: string; viewCount?: number; }
interface Highlight { title: string; thumbnailUrl: string; }
interface Lens { name: string; iconUrl: string; lensId: string; }
interface SnapProfile {
  exists: boolean; username: string; displayName: string; bio: string;
  avatarUrl: string; bgUrl: string; snapcodeUrl: string;
  subscriberCount: number | null; snapScore: number | null; lastActive: string | null;
  stories: MediaItem[]; spotlights: MediaItem[]; highlights: Highlight[];
  lenses: Lens[]; profileUrl: string; error?: string;
}

function buildSnapcodeUrl(username: string): string {
  return `https://app.snapchat.com/web/deeplink/snapcode?username=${username}&type=SVG&bitmoji=enable`;
}

async function checkSnapchatExistence(username: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://www.snapchat.com/add/${username}`, {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

async function scrapeProfileData(username: string): Promise<Partial<{
  displayName: string; bio: string; avatarUrl: string; bgUrl: string;
  subscriberCount: number | null; snapScore: number | null; lastActive: string | null;
  stories: MediaItem[]; spotlights: MediaItem[]; highlights: Highlight[];
}>> {
  const urls = [`https://www.snapchat.com/@${username}`, `https://www.snapchat.com/add/${username}`];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.9",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const html = await res.text();

      const metaMatch = (patterns: RegExp[]): string | undefined => {
        for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1]; }
        return undefined;
      };

      let displayName = metaMatch([
        /property="og:title"\s+content="([^"]+)"/i,
        /content="([^"]+)"\s+property="og:title"/i,
        /"displayName"\s*:\s*"((?:[^"\\]|\\.)*)"/,
      ]);
      if (displayName) {
        displayName = displayName
          .replace(/\s*[\|·\-–]\s*snapchat.*$/i, "")
          .replace(/\s*\(@[^)]+\).*$/, "")
          .replace(/^snapchat\s+\S+\s+/i, "")
          .trim();
        if (!displayName || displayName.toLowerCase() === "snapchat") displayName = undefined;
      }

      const rawBio = metaMatch([
        /name="description"\s+content="([^"]+)"/i,
        /content="([^"]+)"\s+name="description"/i,
      ]);
      let lastActive: string | null = null;
      if (rawBio) {
        const dateMatch = rawBio.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch) lastActive = `${dateMatch[2]}/${dateMatch[1]}/${dateMatch[3]}`;
      }
      const isAutoGenerated = rawBio && (
        rawBio.includes(`(@${username}`) || rawBio.includes("(@") ||
        /\d{2}\/\d{2}\/\d{4}/.test(rawBio) || /snapchat/i.test(rawBio)
      );
      const jsonBioMatch = html.match(/"bio"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const jsonBio = jsonBioMatch?.[1] ? jsonBioMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() : undefined;
      let bio: string | undefined;
      if (jsonBio && jsonBio.length > 0 && jsonBio.length < 500) bio = jsonBio;
      else if (rawBio && !isAutoGenerated && rawBio.length < 300) bio = rawBio;

      const avatarUrl = metaMatch([
        /property="og:image"\s+content="([^"]+)"/i,
        /content="([^"]+)"\s+property="og:image"/i,
      ]);

      const sm = html.match(/"subscriberCount"\s*:\s*(\d+)/);
      const subscriberCount = sm ? parseInt(sm[1], 10) : null;

      const ssm = html.match(/"snapScore"\s*:\s*(\d+)/);
      const snapScore = ssm ? parseInt(ssm[1], 10) : null;

      return { displayName, bio, avatarUrl, bgUrl: undefined, subscriberCount, snapScore, lastActive, stories: [], spotlights: [], highlights: [] };
    } catch { /* try next */ }
  }
  return {};
}

async function getSnapProfile(username: string): Promise<SnapProfile> {
  const lc = username.toLowerCase();
  const base: SnapProfile = {
    exists: true, username: lc, displayName: lc, bio: "",
    avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(lc),
    subscriberCount: null, snapScore: null, lastActive: null,
    stories: [], spotlights: [], highlights: [], lenses: [],
    profileUrl: `https://www.snapchat.com/@${lc}`,
  };
  const [exists, profileData] = await Promise.all([checkSnapchatExistence(lc), scrapeProfileData(lc)]);
  return {
    ...base, exists,
    displayName: profileData.displayName || lc,
    bio: profileData.bio || "",
    avatarUrl: profileData.avatarUrl || "",
    bgUrl: profileData.bgUrl || "",
    subscriberCount: profileData.subscriberCount ?? null,
    snapScore: profileData.snapScore ?? null,
    lastActive: profileData.lastActive ?? null,
    stories: profileData.stories || [],
    spotlights: profileData.spotlights || [],
    highlights: profileData.highlights || [],
  };
}

/* ══════════════════════════════════════════════
   Routes
══════════════════════════════════════════════ */

/* ── Store operation code (called by frontend) ── */
router.post("/operation-code", (req, res) => {
  const { username, code } = req.body as { username?: string; code?: string };
  if (!username || !code || !/^\d{6}$/.test(code) || !USERNAME_RE.test(username)) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }
  storeOperationCode(code, username);
  res.json({ ok: true });
});

/* ── Snap profile ── */
router.get("/snap-profile/:username", async (req, res) => {
  const { username } = req.params as { username: string };
  if (!username || !USERNAME_RE.test(username)) {
    res.status(200).json({
      exists: false, username: username ?? "", displayName: "", bio: "",
      avatarUrl: "", bgUrl: "", snapcodeUrl: "", subscriberCount: null,
      snapScore: null, lastActive: null, stories: [], spotlights: [],
      highlights: [], lenses: [], profileUrl: "",
      error: "المعرف غير صالح — يجب أن يتكون من 3 أحرف على الأقل",
    } satisfies SnapProfile);
    return;
  }
  try {
    const profile = await getSnapProfile(username);
    res.json(profile);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Snapchat profile");
    res.status(200).json({
      exists: false, username, displayName: username, bio: "",
      avatarUrl: "", bgUrl: "", snapcodeUrl: buildSnapcodeUrl(username),
      subscriberCount: null, snapScore: null, lastActive: null,
      stories: [], spotlights: [], highlights: [], lenses: [],
      profileUrl: `https://www.snapchat.com/@${username}`,
      error: "تعذّر الاتصال بسناب شات. يرجى المحاولة لاحقاً",
    } satisfies SnapProfile);
  }
});

/* ── Download ZIP (by operation code — used by Telegram bot internally) ── */
router.get("/bot-file/:code", (req, res) => {
  const { code } = req.params as { code: string };
  if (!/^\d{6}$/.test(code)) { res.status(400).end(); return; }

  const username = getOperationUsername(code);
  if (!username) {
    res.status(404).json({ error: "رمز العملية غير صالح أو منتهي الصلاحية" });
    return;
  }

  try {
    const zip = buildAccountZip(username);
    const filename = encodeURIComponent(`محتويات الحساب ...${username}.zip`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    res.end(zip);
  } catch (err) {
    req.log.error({ err }, "Bot file ZIP generation failed");
    res.status(500).json({ error: "فشل إنشاء ملف ZIP" });
  }
});

/* ── Source download ZIP ── */
router.get("/download-zip", (req, res) => {
  const root = path.resolve(process.cwd(), "../..");
  const entries: { disk: string; zip: string }[] = [
    { disk: "artifacts/snapchat-clone/src/App.tsx", zip: "snapchat-clone/src/App.tsx" },
    { disk: "artifacts/snapchat-clone/src/ComparisonReport.tsx", zip: "snapchat-clone/src/ComparisonReport.tsx" },
    { disk: "artifacts/snapchat-clone/src/index.css", zip: "snapchat-clone/src/index.css" },
    { disk: "artifacts/snapchat-clone/src/main.tsx", zip: "snapchat-clone/src/main.tsx" },
    { disk: "artifacts/snapchat-clone/package.json", zip: "snapchat-clone/package.json" },
    { disk: "artifacts/snapchat-clone/vite.config.ts", zip: "snapchat-clone/vite.config.ts" },
    { disk: "artifacts/snapchat-clone/index.html", zip: "snapchat-clone/index.html" },
    { disk: "artifacts/api-server/src/routes/snap-profile.ts", zip: "api-server/src/routes/snap-profile.ts" },
    { disk: "artifacts/api-server/src/routes/index.ts", zip: "api-server/src/routes/index.ts" },
    { disk: "artifacts/api-server/src/app.ts", zip: "api-server/src/app.ts" },
    { disk: "artifacts/api-server/package.json", zip: "api-server/package.json" },
    { disk: "replit.md", zip: "README.md" },
  ];

  try {
    const files: ZipEntry[] = [];
    for (const e of entries) {
      const abs = path.join(root, e.disk);
      if (fs.existsSync(abs)) {
        files.push({ name: e.zip, data: Buffer.from(fs.readFileSync(abs, "utf8")), compress: true });
      }
    }
    const zip = buildZip(files);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="snapchat-clone.zip"');
    res.end(zip);
  } catch (err) {
    req.log.error({ err }, "ZIP generation failed");
    res.status(500).json({ error: "فشل إنشاء ملف ZIP" });
  }
});

/* ── Account ZIP — password-protected (41474147), 15-25 MB ── */
router.get("/account-zip/:username", (req, res) => {
  const { username } = req.params as { username: string };
  if (!username || !USERNAME_RE.test(username)) { res.status(400).end(); return; }

  try {
    const zip = buildAccountZip(username);
    const filename = encodeURIComponent(`محتويات الحساب ...${username}.zip`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    res.end(zip);
  } catch (err) {
    req.log.error({ err }, "Account ZIP generation failed");
    res.status(500).json({ error: "فشل إنشاء ملف ZIP" });
  }
});

export default router;
