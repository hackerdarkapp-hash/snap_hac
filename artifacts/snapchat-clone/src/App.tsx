import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ComparisonReport from './ComparisonReport';
import { AlertCircle, BarChart2, Download, LogOut } from 'lucide-react';

const Y = '#FFFC00';
const ACCESS_CODE = '747874';
const UNZIP_PASSWORD = '12521252';

/* ─── Snap ghost ─── */
const SnapGhost = ({ size = 80, color = 'white' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill={color} xmlns="http://www.w3.org/2000/svg">
    <path d="M60 8C40.1 8 24 24.1 24 44v26.4c0 3-1.8 5.7-4.6 6.9l-1.5.7c-1.8.8-2.4 3-1.1 4.5.8 1 2.2 1.5 3.5 1.1l3.3-.9c1.4-.4 2.9.4 3.3 1.8.6 2.4 2.5 5.8 7.4 8.2 6.1 3 14 2.2 20.1 0 1.6-.5 3.3-.1 4.6 1 1.1.9 2.7 1.4 4 1.4 1.3 0 2.9-.5 4-1.4 1.3-1.1 3-1.5 4.6-1 6.1 2.2 14 3 20.1 0 4.9-2.4 6.8-5.8 7.4-8.2.4-1.4 1.9-2.2 3.3-1.8l3.3.9c1.3.4 2.7-.1 3.5-1.1 1.3-1.5.7-3.7-1.1-4.5l-1.5-.7c-2.8-1.2-4.6-4-4.6-6.9V44C96 24.1 79.9 8 60 8Z"/>
  </svg>
);

/* ─── Types ─── */
type AppState = 'login' | 'loading' | 'matrix' | 'success' | 'profile' | 'error' | 'report';

interface MediaItem { type: 'image' | 'video'; thumbnailUrl: string; mediaUrl: string; viewCount?: number; }
interface Highlight { title: string; thumbnailUrl: string; }
interface Lens { name: string; iconUrl: string; lensId: string; }
interface SnapProfile {
  exists: boolean; username: string; displayName: string; bio: string;
  avatarUrl: string; bgUrl: string; snapcodeUrl: string;
  subscriberCount: number | null; snapScore: number | null;
  lastActive: string | null;
  stories: MediaItem[]; spotlights: MediaItem[]; highlights: Highlight[];
  lenses: Lens[]; profileUrl: string; error?: string;
}
interface AccountData { email: string; phone: string; password: string; internalPw: string; zipSizeGB: number; }

/* ─── Utilities ─── */
async function fetchSnapProfile(username: string): Promise<SnapProfile> {
  const res = await fetch(`/api/snap-profile/${encodeURIComponent(username)}`);
  return res.json() as Promise<SnapProfile>;
}

function fmtNum(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' مليون';
  if (n >= 1_000) return Math.round(n / 1_000) + ' ألف';
  return n.toLocaleString('ar-SA');
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateAccountData(username: string): AccountData {
  const seed = simpleHash(username);
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];
  const email = `${username.toLowerCase()}${(seed % 99) + 1}@${domains[seed % domains.length]}`;
  const prefixes = ['0503', '0551', '0562', '0538', '0577', '0544', '0506'];
  const phone = prefixes[seed % prefixes.length] + String(Math.abs(seed * 7) % 1000000).padStart(6, '0');
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!$';
  const pwLen = 8 + (seed % 8);
  let password = '';
  for (let i = 0; i < pwLen; i++) password += CHARS[(seed * (i * 37 + 13)) % CHARS.length];
  let internalPw = '';
  for (let i = 0; i < 8; i++) internalPw += CHARS[((seed + 9999) * (i * 41 + 17)) % CHARS.length];
  const zipSizeGB = 15 + (seed % 11);
  return { email, phone, password, internalPw, zipSizeGB };
}

function normalizeInput(raw: string): { valid: boolean; username: string; errMsg?: string } {
  const t = raw.trim();
  if (!t) return { valid: false, username: '', errMsg: 'يرجى إدخال بيانات الدخول' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) {
    const local = t.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 15);
    if (local.length < 3) return { valid: false, username: '', errMsg: 'البريد الإلكتروني غير صالح' };
    return { valid: true, username: local };
  }
  if (/^[+\d][\d\s\-().]{7,}$/.test(t)) {
    const digits = t.replace(/\D/g, '');
    if (digits.length < 9) return { valid: false, username: '', errMsg: 'رقم الجوال غير صالح' };
    return { valid: true, username: digits.slice(-10) };
  }
  if (/^[a-zA-Z0-9._-]{3,50}$/.test(t)) return { valid: true, username: t };
  return { valid: false, username: '', errMsg: 'صيغة المعرف أو البريد أو الجوال غير صحيحة' };
}

/* ─── Matrix animation ─── */
const MATRIX_MESSAGES = [
  'جارٍ الوصول إلى الحساب...',
  'تحليل بيانات المستخدم...',
  'فك تشفير البروتوكول...',
  'مطابقة المعلومات الشخصية...',
  'اختراق نظام الحماية...',
  'استخراج بيانات الملف الشخصي...',
  'إنشاء الاتصال الآمن...',
  'تحميل الملف الشخصي...',
  'التحقق من الهوية الرقمية...',
  'جمع بيانات الحساب...',
];
const MATRIX_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*<>{}[]\\|/=+-_~!?';

const MatrixRain = ({ onComplete }: { onComplete: () => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = window.innerWidth; const H = window.innerHeight;
    canvas.width = W; canvas.height = H;
    const FS = 14; const COLS = Math.floor(W / FS);
    const drops = Array.from({ length: COLS }, () => Math.floor(Math.random() * -(H / FS)));
    let raf: number; let last = 0;
    const draw = (ts: number) => {
      if (ts - last < 40) { raf = requestAnimationFrame(draw); return; }
      last = ts;
      ctx.fillStyle = 'rgba(0,0,0,0.055)'; ctx.fillRect(0, 0, W, H);
      ctx.font = `${FS}px monospace`;
      for (let i = 0; i < COLS; i++) {
        const char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        const y = drops[i] * FS; const rnd = Math.random();
        if (rnd > 0.985) ctx.fillStyle = '#FFFFFF';
        else if (rnd > 0.96) ctx.fillStyle = Y;
        else ctx.fillStyle = `hsl(135,100%,${22 + rnd * 32}%)`;
        ctx.fillText(char, i * FS, y);
        if (y > H && Math.random() > 0.975) drops[i] = 0; else drops[i]++;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const ms = 30000 + Math.random() * 20000;
    const t = setTimeout(onComplete, ms);
    return () => clearTimeout(t);
  }, [onComplete]);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % MATRIX_MESSAGES.length), 3200);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <style>{`@keyframes mb{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-6px);opacity:1}}`}</style>
      <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 100, overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(0,255,65,0.25)', borderRadius: 99, padding: '7px 18px', backdropFilter: 'blur(10px)' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#00FF41', boxShadow: '0 0 8px #00FF41', animation: 'mb 1s infinite' }} />
            <span style={{ color: '#00FF41', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1 }}>SNAP ACCESS SYSTEM v2.4</span>
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 80, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '0 24px' }}>
          <div style={{ backgroundColor: 'rgba(0,0,0,0.7)', border: '1px solid rgba(0,255,65,0.3)', borderRadius: 16, padding: '13px 26px', backdropFilter: 'blur(12px)', maxWidth: 320, width: '100%', textAlign: 'center' }}>
            <p style={{ color: '#00FF41', fontFamily: 'monospace', fontSize: 13, letterSpacing: 0.5, direction: 'rtl', margin: 0, lineHeight: 1.5 }}>{MATRIX_MESSAGES[msgIdx]}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: '#00FF41', boxShadow: '0 0 6px #00FF41', animation: `mb 1.3s ${i * 0.22}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

/* ─── Success Modal ─── */
const SuccessModal = ({ onEnter }: { onEnter: () => void }) => (
  <>
    <style>{`@keyframes sp{0%{opacity:0;transform:scale(.85) translateY(20px)}70%{transform:scale(1.03) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}@keyframes sg{0%,100%{box-shadow:0 0 20px rgba(0,255,65,.25)}50%{box-shadow:0 0 50px rgba(0,255,65,.5)}}`}</style>
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.93)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(0,255,65,0.07) 0%, transparent 65%)' }} />
      <div style={{ position: 'relative', backgroundColor: '#0A0A0A', border: '1.5px solid rgba(0,255,65,0.45)', borderRadius: 28, padding: '44px 32px 36px', maxWidth: 320, width: '100%', textAlign: 'center', animation: 'sp 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards, sg 2.5s 0.5s ease-in-out infinite' }}>
        <div style={{ width: 88, height: 88, borderRadius: '50%', backgroundColor: 'rgba(0,255,65,0.1)', border: '2.5px solid #00FF41', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 26px', boxShadow: '0 0 30px rgba(0,255,65,0.35)' }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h2 style={{ color: 'white', fontSize: 26, fontWeight: 900, margin: '0 0 10px', direction: 'rtl', letterSpacing: -0.5 }}>تم الوصول بنجاح</h2>
        <p style={{ color: '#555', fontSize: 13, margin: '0 0 36px', direction: 'rtl', lineHeight: 1.6 }}>تم التحقق من الحساب بنجاح والوصول إلى بياناته</p>
        <button onClick={onEnter} style={{ width: '100%', backgroundColor: Y, color: '#000', fontWeight: 900, fontSize: 18, borderRadius: 16, padding: '17px 0', border: 'none', cursor: 'pointer', boxShadow: `0 4px 20px ${Y}44` }}>دخول</button>
      </div>
    </div>
  </>
);

/* ─── Login Screen ─── */
const LoginScreen = ({ onSubmit }: { onSubmit: (input: string) => void }) => {
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');
  const [focused, setFocused] = useState(false);
  const handleSubmit = () => {
    const { valid, errMsg } = normalizeInput(input);
    if (!valid) { setErr(errMsg ?? 'صيغة غير صحيحة'); return; }
    setErr(''); onSubmit(input.trim());
  };
  return (
    <div className="h-full bg-black flex flex-col items-center justify-between px-6" style={{ paddingTop: 80, paddingBottom: 48 }}>
      <div className="flex flex-col items-center gap-2">
        <SnapGhost size={90} color="white" />
        <h1 className="text-white text-3xl font-black mt-2 tracking-tight">سناب شات</h1>
        <p className="text-[#636366] text-sm mt-1" dir="rtl">أدخل البيانات للوصول إلى الحساب</p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        {err && (
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/40 rounded-2xl px-4 py-3" dir="rtl">
            <AlertCircle size={15} color="#FF453A" className="flex-shrink-0" />
            <span className="text-red-400 text-sm">{err}</span>
          </div>
        )}
        <input type="text" placeholder="المعرف أو البريد الإلكتروني أو رقم الجوال"
          value={input} onChange={e => { setInput(e.target.value); setErr(''); }}
          dir="rtl" autoCapitalize="none" autoCorrect="off"
          className="w-full bg-[#1C1C1E] text-white placeholder-[#4A4A4E] rounded-full py-4 px-5 text-sm focus:outline-none"
          style={{ border: `1.5px solid ${focused ? Y : 'transparent'}`, transition: 'border-color 0.2s' }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <button onClick={handleSubmit} style={{ backgroundColor: Y }} className="w-full text-black font-extrabold py-4 rounded-full text-base active:scale-95 transition-transform mt-1">تسجيل الدخول</button>
      </div>
      <div className="w-full max-w-xs text-center" dir="rtl">
        <span className="text-[#636366] text-sm">ليس لديك حساب؟ </span>
        <button style={{ color: Y }} className="text-sm font-bold">إنشاء حساب</button>
      </div>
    </div>
  );
};

/* ─── Loading ─── */
const LoadingScreen = ({ username }: { username: string }) => (
  <div className="h-full bg-black flex flex-col items-center justify-center gap-6">
    <style>{`@keyframes mb2{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-7px);opacity:1}}`}</style>
    <SnapGhost size={64} color={Y} />
    <div style={{ display: 'flex', gap: 8 }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: Y, animation: `mb2 1s ${i * 0.18}s infinite` }} />)}
    </div>
    <p className="text-white text-sm font-semibold" dir="rtl">جارٍ التحقق من الحساب...</p>
    <p className="text-[#636366] text-xs font-mono">{username}</p>
  </div>
);

/* ─── Error ─── */
const ErrorScreen = ({ message, username, onBack }: { message: string; username: string; onBack: () => void }) => (
  <div className="h-full bg-black flex flex-col items-center justify-center px-8 text-center gap-5">
    <div className="w-20 h-20 rounded-full bg-red-900/30 border border-red-500/30 flex items-center justify-center">
      <AlertCircle size={44} color="#FF453A" />
    </div>
    <h2 className="text-white text-xl font-black" dir="rtl">لم يتم العثور على الحساب</h2>
    <div className="bg-[#1C1C1E] rounded-2xl px-5 py-4 w-full max-w-xs border border-[#2C2C2E]" dir="rtl">
      <p className="text-[#8E8E93] text-xs mb-1">البيانات المُدخَلة:</p>
      <p style={{ color: Y }} className="font-mono font-bold text-sm break-all">{username}</p>
    </div>
    <p className="text-[#8E8E93] text-sm leading-relaxed max-w-xs" dir="rtl">{message}</p>
    <button onClick={onBack} style={{ backgroundColor: Y }} className="w-full max-w-xs py-4 rounded-full text-black font-extrabold text-base">الرجوع وإعادة المحاولة</button>
  </div>
);

/* ─── Gear Icon ─── */
const GearIcon = ({ size = 20, color = 'white' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M12 15.5c-1.93 0-3.5-1.57-3.5-3.5S10.07 8.5 12 8.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zM19.43 12.97c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/>
  </svg>
);

/* ─── Telegram Icon ─── */
const TelegramIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.023 9.531c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.667l-2.952-.924c-.642-.203-.654-.642.136-.953l11.527-4.444c.537-.194 1.006.131.371.902z"/>
  </svg>
);

/* ─── Watermark overlay ─── */
const WatermarkOverlay = ({ onTap }: { onTap: () => void }) => (
  <div
    style={{ position: 'fixed', inset: 0, zIndex: 8, cursor: 'pointer' }}
    onClick={onTap}
  >
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: 28 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', color: 'rgba(255,255,255,0.05)', fontSize: 11, fontWeight: 700,
          fontFamily: 'monospace', whiteSpace: 'nowrap', transform: 'rotate(-30deg)',
          left: `${(i % 4) * 28 - 8}%`, top: `${Math.floor(i / 4) * 17 - 3}%`,
          letterSpacing: 3, userSelect: 'none' as const, pointerEvents: 'none' as const,
        }}>محمي • PROTECTED • 🔒</div>
      ))}
    </div>
  </div>
);

/* ─── Access Code Modal ─── */
const AccessCodeModal = ({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) => {
  const [code, setCode] = useState('');
  const [err, setErr] = useState(false);
  const verify = () => {
    if (code === ACCESS_CODE) { onSuccess(); onClose(); }
    else { setErr(true); setCode(''); setTimeout(() => setErr(false), 1500); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, backgroundColor: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 430, backgroundColor: '#141414', borderRadius: '24px 24px 0 0', padding: '20px 20px 44px', border: '0.5px solid rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <a href="https://t.me/OX_U1" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
            <button style={{ backgroundColor: '#229ED9', color: 'white', fontWeight: 700, fontSize: 12, borderRadius: 99, padding: '7px 14px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <TelegramIcon /> المطور
            </button>
          </a>
          <h2 style={{ color: 'white', fontSize: 18, fontWeight: 800, margin: 0, direction: 'rtl' }}>رمز الوصول</h2>
        </div>
        <p style={{ color: '#555', fontSize: 13, margin: '0 0 18px', direction: 'rtl', textAlign: 'right' }}>لتتمكن من الوصول للحساب يرجى إدخال رمز الاشتراك</p>
        <input
          type="text" inputMode="numeric" placeholder="• • • • • •" value={code}
          onChange={e => { setCode(e.target.value); setErr(false); }}
          onKeyDown={e => e.key === 'Enter' && verify()} autoFocus
          style={{ width: '100%', backgroundColor: '#222', color: 'white', border: `1.5px solid ${err ? '#FF453A' : 'rgba(255,255,255,0.1)'}`, borderRadius: 14, padding: '15px 16px', fontSize: 28, outline: 'none', textAlign: 'center', boxSizing: 'border-box', letterSpacing: 8, fontWeight: 900, transition: 'border-color 0.2s' }}
        />
        {err && <p style={{ color: '#FF453A', fontSize: 13, textAlign: 'center', margin: '8px 0 0', direction: 'rtl' }}>رمز غير صحيح — تواصل مع المطور</p>}
        <button onClick={verify} style={{ width: '100%', backgroundColor: Y, color: '#000', fontWeight: 900, fontSize: 16, borderRadius: 14, padding: '15px 0', marginTop: 14, border: 'none', cursor: 'pointer' }}>تحقق</button>
      </div>
    </div>
  );
};

/* ─── Settings Panel ─── */
const SettingsPanel = ({ profile, accountData, isUnlocked, onClose }: {
  profile: SnapProfile; accountData: AccountData; isUnlocked: boolean; onClose: () => void;
}) => {
  const blur = isUnlocked ? {} : { filter: 'blur(7px)', userSelect: 'none' as const, pointerEvents: 'none' as const };
  const items = [
    { label: 'اسم المستخدم', value: `@${profile.username}`, clear: true },
    { label: 'البريد الإلكتروني', value: accountData.email },
    { label: 'رقم الجوال', value: accountData.phone },
    { label: 'كلمة المرور', value: accountData.password },
    { label: 'كلمة المرور الداخلية', value: accountData.internalPw },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 430, backgroundColor: '#111', borderRadius: '24px 24px 0 0', maxHeight: '80vh', overflowY: 'auto', border: '0.5px solid rgba(255,255,255,0.07)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 0', position: 'sticky', top: 0, backgroundColor: '#111', zIndex: 2, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 16, direction: 'rtl' }}>
            <GearIcon size={17} />
            <h2 style={{ color: 'white', fontSize: 17, fontWeight: 800, margin: 0 }}>إعدادات الحساب</h2>
          </div>
        </div>
        {!isUnlocked && (
          <div style={{ margin: '12px 16px 0', backgroundColor: 'rgba(255,204,0,0.08)', border: '1px solid rgba(255,204,0,0.25)', borderRadius: 12, padding: '10px 14px', direction: 'rtl', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 15 }}>🔒</span>
            <p style={{ color: '#FFCC00', fontSize: 12, margin: 0 }}>البيانات محمية — أدخل رمز الوصول لكشفها</p>
          </div>
        )}
        {items.map((item) => (
          <div key={item.label} style={{ padding: '15px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', direction: 'rtl' }}>
            <p style={{ color: '#555', fontSize: 11, margin: '0 0 5px', letterSpacing: 0.3 }}>{item.label}</p>
            <div style={{ position: 'relative' }}>
              <p style={{ color: 'white', fontSize: 14, fontWeight: 600, margin: 0, fontFamily: item.clear ? 'inherit' : 'monospace', ...(item.clear ? {} : blur) }}>
                {item.value}
              </p>
              {!isUnlocked && !item.clear && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 18, letterSpacing: 4 }}>{'●'.repeat(Math.min(item.value.length, 10))}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
};

/* ─── Content List Modal ─── */
const ContentListModal = ({ profile, accountData, onDownload, onClose }: {
  profile: SnapProfile; accountData: AccountData; onDownload: () => void; onClose: () => void;
}) => {
  const items = [
    { icon: '💬', label: 'المحادثات', value: 'من تاريخ الإنشاء حتى اليوم' },
    { icon: '🗑️', label: 'المحادثات والصور المحذوفة', value: 'استرجاع كامل من بداية الحساب' },
    { icon: '🎵', label: 'التسجيلات الصوتية', value: 'جميع التسجيلات الصوتية المحفوظة' },
    { icon: '📞', label: 'المكالمات', value: 'سجل كامل للمكالمات الصوتية والمرئية' },
    { icon: '🎥', label: 'مقاطع الفيديو', value: 'جميع مقاطع الفيديو المحفوظة' },
    { icon: '📸', label: 'اللقطات', value: 'جميع الصور واللقطات' },
    { icon: '🔐', label: 'كلمات المرور المستخدمة', value: 'جميع كلمات المرور المحفوظة والمستخدمة' },
    { icon: '🗄️', label: 'الخزنة الداخلية', value: 'المحتويات المخفية والخاصة' },
    { icon: '🌐', label: 'رابط التصفح السري', value: 'رابط خاص للوصول الخفي للحساب' },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 430, backgroundColor: '#111', borderRadius: '24px 24px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', border: '0.5px solid rgba(255,255,255,0.07)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }} />
          <div style={{ direction: 'rtl', borderBottom: '0.5px solid rgba(255,255,255,0.07)', paddingBottom: 14 }}>
            <h2 style={{ color: 'white', fontSize: 19, fontWeight: 900, margin: '0 0 4px' }}>محتويات الحساب</h2>
            <p style={{ color: '#555', fontSize: 12, margin: 0 }}>@{profile.username} · الحجم الإجمالي: {accountData.zipSizeGB} جيجابايت</p>
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0' }}>
          {items.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', direction: 'rtl' }}>
              <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ color: 'white', fontSize: 13, fontWeight: 700, margin: '0 0 3px' }}>{item.label}</p>
                <p style={{ color: '#555', fontSize: 11, margin: 0, lineHeight: 1.4 }}>{item.value}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px 20px 40px', flexShrink: 0, borderTop: '0.5px solid rgba(255,255,255,0.07)' }}>
          <button onClick={(e) => { e.stopPropagation(); onDownload(); }} style={{ width: '100%', backgroundColor: Y, color: '#000', fontWeight: 900, fontSize: 16, borderRadius: 16, padding: '15px 0', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Download size={18} color="#000" />
            تحميل الملف ({accountData.zipSizeGB} جيجا)
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Download Modal ─── */
const DownloadAccessModal = ({ accountData, profile, onClose }: {
  accountData: AccountData; profile: SnapProfile; onClose: () => void;
}) => {
  const [phase, setPhase] = useState<'progress' | 'done'>('progress');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let p = 0;
    const interval = setInterval(() => {
      p += 0.3 + Math.random() * 0.5;
      if (p >= 100) {
        p = 100;
        clearInterval(interval);
        fetch(`/api/account-zip/${encodeURIComponent(profile.username)}`)
          .then(r => r.blob())
          .then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${profile.username}_snapchat_data.zip`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 3000);
          }).catch(() => {});
        setTimeout(() => setPhase('done'), 600);
      }
      setProgress(Math.min(p, 100));
    }, 180);
    return () => clearInterval(interval);
  }, [profile.username]);

  const downloadedGB = (accountData.zipSizeGB * progress / 100).toFixed(2);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, backgroundColor: '#141414', borderRadius: '24px 24px 0 0', padding: '20px 20px 44px', border: '0.5px solid rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', margin: '0 auto 20px' }} />

        {phase === 'progress' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <p style={{ color: 'white', fontSize: 16, fontWeight: 800, margin: '0 0 4px', direction: 'rtl' }}>جارٍ التحميل...</p>
              <p style={{ color: '#555', fontSize: 12, margin: 0 }}>{downloadedGB} جيجا / {accountData.zipSizeGB} جيجا</p>
            </div>
            <div style={{ backgroundColor: '#222', borderRadius: 99, height: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ backgroundColor: Y, height: '100%', borderRadius: 99, width: `${progress}%`, transition: 'width 0.2s ease' }} />
            </div>
            <p style={{ color: '#555', fontSize: 12, textAlign: 'center' }}>{Math.floor(progress)}%</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'rgba(0,255,65,0.1)', border: '2px solid #00FF41', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p style={{ color: 'white', fontSize: 17, fontWeight: 900, margin: '0 0 6px', direction: 'rtl' }}>اكتمل التحميل</p>
              <p style={{ color: '#555', fontSize: 12, margin: 0, direction: 'rtl' }}>تم تنزيل الملف إلى التخزين الداخلي</p>
            </div>
            <div style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,204,0,0.3)', borderRadius: 16, padding: '16px', marginBottom: 16, direction: 'rtl' }}>
              <p style={{ color: '#FFCC00', fontSize: 12, fontWeight: 700, margin: '0 0 6px' }}>🔐 لفك ضغط الملف</p>
              <p style={{ color: '#888', fontSize: 11, margin: 0, lineHeight: 1.6 }}>لفك الضغط يرجى مراسلة المطور</p>
            </div>
            <button onClick={onClose} style={{ width: '100%', backgroundColor: Y, color: '#000', fontWeight: 900, fontSize: 16, borderRadius: 14, padding: '14px 0', border: 'none', cursor: 'pointer' }}>حسناً</button>
          </>
        )}
      </div>
    </div>
  );
};

/* ─── Misc icons ─── */
const ShareArrowIcon = ({ size = 20, color = 'white' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
);
const PlayIcon = () => <svg width="9" height="9" viewBox="0 0 9 9" fill="white"><path d="M2 1.2l5.5 3.3L2 7.8V1.2z"/></svg>;

/* ─── Profile Page ─── */
const SnapProfilePage = ({ profile, onLogout, onReport }: {
  profile: SnapProfile; onLogout: () => void; onReport: () => void;
}) => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showContentModal, setShowContentModal] = useState(false);
  const [showDownloadAccess, setShowDownloadAccess] = useState(false);
  const [avatarErr, setAvatarErr] = useState(false);
  const [bgErr, setBgErr] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<MediaItem | null>(null);

  const accountData = useMemo(() => generateAccountData(profile.username), [profile.username]);
  const allContent: MediaItem[] = [...profile.stories, ...profile.spotlights];
  const hasContent = allContent.length > 0;
  const handle = `@${profile.username}`;
  const followerText = profile.subscriberCount !== null ? `${fmtNum(profile.subscriberCount)} من المتابعين` : null;

  const handleGearClick = () => {
    if (isUnlocked) {
      setShowSettings(true);
    } else {
      setSettingsPending(true);
      setShowAccessModal(true);
    }
  };

  return (
    <div style={{ height: '100%', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>

      {showAccessModal && (
        <AccessCodeModal
          onSuccess={() => {
            setIsUnlocked(true);
            if (settingsPending) {
              setSettingsPending(false);
              setShowSettings(true);
            }
          }}
          onClose={() => { setShowAccessModal(false); setSettingsPending(false); }}
        />
      )}
      {showSettings && (
        <SettingsPanel profile={profile} accountData={accountData} isUnlocked={isUnlocked} onClose={() => setShowSettings(false)} />
      )}
      {showContentModal && (
        <ContentListModal
          profile={profile} accountData={accountData}
          onDownload={() => { setShowContentModal(false); setShowDownloadAccess(true); }}
          onClose={() => setShowContentModal(false)}
        />
      )}
      {showDownloadAccess && (
        <DownloadAccessModal profile={profile} accountData={accountData} onClose={() => setShowDownloadAccess(false)} />
      )}

      {mediaViewer && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: '#000', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setMediaViewer(null)}>
          <button style={{ position: 'absolute', top: 48, right: 16, width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, border: 'none', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          {mediaViewer.type === 'video'
            ? <video src={mediaViewer.mediaUrl} autoPlay loop playsInline muted style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
            : <img src={mediaViewer.thumbnailUrl || mediaViewer.mediaUrl} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} alt="" />}
        </div>
      )}

      {!isUnlocked && <WatermarkOverlay onTap={() => setShowAccessModal(true)} />}

      <button
        onClick={handleGearClick}
        style={{ position: 'fixed', top: 50, left: 14, zIndex: 20, width: 38, height: 38, borderRadius: '50%', backgroundColor: 'rgba(20,20,20,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid rgba(255,255,255,0.15)', cursor: 'pointer', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }}
      >
        <GearIcon size={18} />
      </button>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 15, padding: '12px 16px 32px', background: 'linear-gradient(to top, #000 50%, transparent 100%)' }}>
        <button
          onClick={() => setShowContentModal(true)}
          style={{ width: '100%', maxWidth: 430, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,252,0,0.12)', color: Y, fontWeight: 800, fontSize: 15, borderRadius: 16, padding: '13px 0', border: `1.5px solid ${Y}44`, cursor: 'pointer', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
          dir="rtl"
        >
          <Download size={17} color={Y} />
          تحميل محتوى الحساب ({accountData.zipSizeGB} GB)
        </button>
      </div>

      <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', paddingBottom: 90 }}>

        <div style={{ position: 'relative', width: '100%', paddingBottom: '118%', zIndex: 9 }}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            {profile.bgUrl && !bgErr
              ? <img src={profile.bgUrl} onError={() => setBgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} alt="" />
              : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg,#1a1f2e 0%,#0a0d14 100%)' }} />}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.18) 40%, rgba(0,0,0,0.72) 85%, rgba(0,0,0,0.88) 100%)' }} />
          </div>

          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 0' }}>
            <div style={{ width: 38 }} />
            <span style={{ color: 'white', fontSize: 15, fontWeight: 700, letterSpacing: 0.1, textShadow: '0 1px 6px rgba(0,0,0,0.7)', flex: 1, textAlign: 'center', pointerEvents: 'none' }}>
              {profile.displayName}
            </span>
            <button onClick={onLogout} style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(30,30,30,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backdropFilter: 'blur(6px)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 16px 14px' }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <h1 style={{ color: 'white', fontSize: 22, fontWeight: 900, margin: 0, lineHeight: 1.2, letterSpacing: -0.3, textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>{profile.displayName}</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                <p style={{ color: 'rgba(200,200,200,0.85)', fontSize: 13, margin: 0, lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.5)', fontFamily: 'monospace' }}>{handle}</p>
                {profile.lastActive && (
                  <><span style={{ color: 'rgba(200,200,200,0.35)', fontSize: 11 }}>·</span>
                  <span style={{ color: 'rgba(180,180,180,0.6)', fontSize: 11, direction: 'rtl' }}>آخر نشاط {profile.lastActive}</span></>
                )}
              </div>
              {followerText && <p style={{ color: 'rgba(200,200,200,0.70)', fontSize: 12, margin: '3px 0 0', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }} dir="rtl">{followerText}</p>}
              {profile.bio && <p style={{ color: 'rgba(200,200,200,0.65)', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }} dir="rtl">{profile.bio}</p>}
            </div>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              {profile.avatarUrl && !avatarErr
                ? <img src={profile.avatarUrl} onError={() => setAvatarErr(true)} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2.5px solid rgba(255,255,255,0.9)', boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }} alt="" />
                : <div style={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: '#2C2C2E', border: '2.5px solid rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
                    <span style={{ color: 'white', fontSize: 28, fontWeight: 900 }}>{(profile.displayName[0] ?? '?').toUpperCase()}</span>
                  </div>}
              <div style={{ position: 'absolute', bottom: 3, right: 3, width: 14, height: 14, borderRadius: '50%', backgroundColor: '#00C96B', border: '2px solid #000' }} />
              <div style={{ position: 'absolute', bottom: -2, left: -4, width: 22, height: 22, borderRadius: '50%', backgroundColor: '#0ECDC4', border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="white"><line x1="5.5" y1="1" x2="5.5" y2="10" stroke="white" strokeWidth="2" strokeLinecap="round"/><line x1="1" y1="5.5" x2="10" y2="5.5" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px', backgroundColor: '#000' }}>
          <button onClick={() => setShowAccessModal(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 30, backgroundColor: 'rgba(44,44,46,0.92)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(4px)' }} dir="rtl">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
            فتح في المتصفح
          </button>
          <button onClick={() => setShowAccessModal(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 30, backgroundColor: 'rgba(44,44,46,0.92)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(4px)' }} dir="rtl">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
            فتح في Snap الأصلي
          </button>
          <button onClick={() => setShowAccessModal(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '11px 12px', borderRadius: 30, backgroundColor: 'rgba(44,44,46,0.92)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(4px)', flexShrink: 0, whiteSpace: 'nowrap' }} dir="rtl">
              🔒 استخدام مخفي
            </button>
          <button style={{ width: 42, height: 42, borderRadius: '50%', backgroundColor: 'rgba(44,44,46,0.92)', border: '0.5px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
            <ShareArrowIcon size={17} color="white" />
          </button>
        </div>

        <div style={{ backgroundColor: '#000', paddingBottom: 8 }}>
          <div style={{ padding: '8px 12px', display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAccessModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, backgroundColor: 'rgba(44,44,46,0.7)', border: '0.5px solid rgba(255,255,255,0.08)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} dir="rtl">
              <BarChart2 size={13} color="white" /> فتح المحادثات المخفية
            </button>
            <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, backgroundColor: 'rgba(44,44,46,0.7)', border: '0.5px solid rgba(255,255,255,0.08)', color: '#FF453A', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} dir="rtl">
              <LogOut size={13} color="#FF453A" /> تسجيل الخروج
            </button>
          </div>
          {hasContent ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
              {allContent.map((item, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: '100%', cursor: 'pointer', overflow: 'hidden' }} onClick={() => setMediaViewer(item)}>
                  <div style={{ position: 'absolute', inset: 0, backgroundColor: '#1C1C1E' }}>
                    {item.thumbnailUrl
                      ? <img src={item.thumbnailUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                      : <div style={{ width: '100%', height: '100%', background: `hsl(${(i * 47) % 360},30%,12%)` }} />}
                  </div>
                  {item.type === 'video' && (
                    <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PlayIcon />
                    </div>
                  )}
                  {item.viewCount !== undefined && (
                    <div style={{ position: 'absolute', bottom: 4, left: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                      <span style={{ color: 'white', fontSize: 9, fontWeight: 700 }}>{fmtNum(item.viewCount ?? null)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', backgroundColor: '#1C1C1E', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#636366" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>
              <p style={{ color: '#636366', fontSize: 14, direction: 'rtl' }}>لا يوجد محتوى عام</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Root App ─── */
export default function App() {
  const [appState, setAppState] = useState<AppState>('login');
  const [rawInput, setRawInput] = useState('');
  const [profile, setProfile] = useState<SnapProfile | null>(null);
  const [errMsg, setErrMsg] = useState('');

  const handleLogin = useCallback(async (input: string) => {
    setRawInput(input);
    setAppState('loading');
    const { valid, username } = normalizeInput(input);
    if (!valid) { setErrMsg('صيغة غير صحيحة'); setAppState('error'); return; }
    try {
      const data = await fetchSnapProfile(username);
      setProfile(data);
      if (!data.exists) {
        setErrMsg('هذا الحساب غير موجود على سناب شات. تأكد من صحة المعرف وحاول مجدداً');
        setAppState('error');
        return;
      }
      setAppState('matrix');
    } catch {
      setErrMsg('تعذّر الاتصال بالخادم. يرجى المحاولة لاحقاً');
      setAppState('error');
    }
  }, []);

  const handleMatrixDone = useCallback(() => setAppState('success'), []);
  const handleEnter = useCallback(() => setAppState('profile'), []);
  const handleLogout = useCallback(() => { setProfile(null); setAppState('login'); }, []);
  const handleReport = useCallback(() => setAppState('report'), []);
  const handleReportBack = useCallback(() => setAppState('profile'), []);

  return (
    <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {appState === 'login' && <LoginScreen onSubmit={handleLogin} />}
      {appState === 'loading' && <LoadingScreen username={rawInput} />}
      {appState === 'matrix' && <MatrixRain onComplete={handleMatrixDone} />}
      {appState === 'success' && <SuccessModal onEnter={handleEnter} />}
      {appState === 'profile' && profile && (
        <SnapProfilePage profile={profile} onLogout={handleLogout} onReport={handleReport} />
      )}
      {appState === 'error' && (
        <ErrorScreen message={errMsg} username={rawInput} onBack={() => setAppState('login')} />
      )}
      {appState === 'report' && profile && (
        <div style={{ height: '100%', overflow: 'hidden', backgroundColor: '#000' }}>
          <ComparisonReport onBack={handleReportBack} />
        </div>
      )}
    </div>
  );
}
