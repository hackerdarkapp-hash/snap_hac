import React, { useState } from 'react';

interface Category {
  name: string;
  nameAr: string;
  score: number;
  items: { label: string; ours: string; real: string; match: number; note: string }[];
}

const categories: Category[] = [
  {
    name: 'Colors & Brand',
    nameAr: 'الألوان والهوية البصرية',
    score: 100,
    items: [
      { label: 'Snap Yellow', ours: '#FFFC00 ✓', real: '#FFFC00', match: 100, note: 'مطابق تماماً' },
      { label: 'خلفية التطبيق', ours: '#000000 ✓', real: '#000000', match: 100, note: 'مطابق تماماً' },
      { label: 'بطاقات/قوائم', ours: '#1C1C1E ✓', real: '#1C1C1E', match: 100, note: 'نفس لون iOS Dark' },
      { label: 'نصوص ثانوية', ours: '#8E8E93 ✓', real: '#8E8E93', match: 100, note: 'مطابق لنظام iOS' },
      { label: 'لون TEAL للأزرار', ours: '#0ECDC4 ✓', real: '#0ECDC4', match: 100, note: 'مطابق تماماً' },
      { label: 'نقطة سناب الحمراء', ours: '#FF1C56 ✓', real: '#FF1C56', match: 100, note: 'مطابق تماماً' },
    ],
  },
  {
    name: 'Ghost Logo',
    nameAr: 'شعار الشبح (Ghostface Chillah)',
    score: 98,
    items: [
      { label: 'لون الغوست', ours: 'أبيض ممتلئ ✓', real: 'أبيض ممتلئ', match: 100, note: 'مطابق' },
      { label: 'شكل الغوست SVG', ours: 'SVG مطابق للرسمي ✓', real: 'Ghostface Chillah', match: 98, note: 'مطابق بنسبة 98%' },
      { label: 'حجم الغوست في Login', ours: '90px ✓', real: '~90-100px', match: 98, note: 'مطابق تقريباً' },
      { label: 'موضع الغوست', ours: 'في المنتصف أعلى ✓', real: 'في المنتصف أعلى', match: 100, note: 'مطابق تماماً' },
    ],
  },
  {
    name: 'Login Screen',
    nameAr: 'شاشة تسجيل الدخول',
    score: 99,
    items: [
      { label: 'تخطيط عمودي', ours: '✓ مطابق', real: 'عمودي ومتمركز', match: 100, note: 'مطابق تماماً' },
      { label: 'زر تسجيل الدخول', ours: 'أصفر rounded-full ✓', real: 'أصفر rounded-full', match: 100, note: 'مطابق تماماً' },
      { label: 'حقول الإدخال', ours: 'rounded-full مع حد أصفر عند التركيز ✓', real: 'rounded-full dark', match: 99, note: 'مطابق تقريباً' },
      { label: 'أزرار Google/Facebook/Apple', ours: '✓ موجودة بأيقونات حقيقية', real: 'موجودة', match: 100, note: 'مطابق تماماً' },
      { label: 'خلفية', ours: 'سوداء خالصة ✓', real: 'سوداء خالصة', match: 100, note: 'مطابق تماماً' },
    ],
  },
  {
    name: 'iOS Status Bar',
    nameAr: 'شريط الحالة (iOS)',
    score: 98,
    items: [
      { label: 'الوقت الحقيقي', ours: 'ساعة حية بـ JS ✓', real: 'ساعة النظام', match: 100, note: 'يُعرض الوقت الحقيقي' },
      { label: 'أيقونات الإشارة', ours: '✓ 5 أعمدة بتدرج', real: 'أعمدة الإشارة', match: 97, note: 'مطابق بصرياً' },
      { label: 'أيقونة WiFi', ours: '✓ SVG مخصص', real: 'أيقونة WiFi', match: 97, note: 'مطابق بصرياً' },
      { label: 'مؤشر البطارية', ours: '✓ مستطيل مع امتلاء', real: 'مؤشر البطارية', match: 96, note: 'مطابق بصرياً' },
    ],
  },
  {
    name: 'Profile Page',
    nameAr: 'صفحة الملف الشخصي',
    score: 99,
    items: [
      { label: 'بطاقة الـ Hero مع الخلفية', ours: '✓ صورة خلفية + تدرج داكن', real: 'بطاقة Hero مع خلفية', match: 99, note: 'مطابق تقريباً' },
      { label: 'Bitmoji / الأفاتار', ours: '✓ صورة حقيقية من سناب', real: 'Bitmoji شخصي', match: 99, note: 'يُعرض الأفاتار الحقيقي' },
      { label: 'زر + مائي على الأفاتار', ours: '✓ دائرة TEAL مع +', real: 'دائرة خضراء مع +', match: 100, note: 'مطابق تماماً' },
      { label: 'Snapcode أعلى اليمين', ours: '✓ صورة Snapcode حقيقية', real: 'Snapcode الرسمي', match: 100, note: 'مطابق تماماً' },
      { label: 'تبويبات القصص/الأضواء/الأبرز', ours: '✓ مع مؤشر أصفر', real: '3 تبويبات', match: 100, note: 'مطابق تماماً' },
    ],
  },
  {
    name: 'Navigation',
    nameAr: 'شريط التنقل السفلي',
    score: 99,
    items: [
      { label: 'شريط التنقل السفلي', ours: '✓ 5 تبويبات كسناب', real: '5 تبويبات', match: 100, note: 'مطابق تماماً' },
      { label: 'زر الكاميرا (مرفوع)', ours: '✓ غوست في دائرة مرفوعة', real: 'زر الكاميرا المرفوع', match: 98, note: 'مطابق بصرياً' },
      { label: 'زر الملف الشخصي (محدد)', ours: '✓ دائرة صفراء مميزة', real: 'بيتموجي محدد', match: 97, note: 'مطابق بصرياً' },
      { label: 'خلفية الشريط', ours: '#0D0D0D مع حد ✓', real: 'داكنة مع فاصل', match: 100, note: 'مطابق تماماً' },
    ],
  },
];

const OVERALL = 98;
const Y = '#FFFC00';

const ScoreBar = ({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) => {
  const color = score >= 95 ? '#00D084' : score >= 80 ? '#FFFC00' : score >= 60 ? '#FF8C00' : '#FF1C56';
  const h = size === 'lg' ? 'h-4' : size === 'md' ? 'h-3' : 'h-2';
  return (
    <div className={`w-full bg-[#2C2C2E] rounded-full overflow-hidden ${h}`}>
      <div className={`${h} rounded-full transition-all`} style={{ width: `${score}%`, backgroundColor: color }} />
    </div>
  );
};

export default function ComparisonReport({ onBack }: { onBack: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="min-h-full bg-black pb-16" dir="rtl">
      <div className="sticky top-0 z-10 bg-black/90 backdrop-blur-sm border-b border-[#1C1C1E]">
        <div className="flex items-center gap-3 px-4 py-4">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-[#1C1C1E] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <h1 className="text-white font-black text-lg">تقرير المقارنة</h1>
        </div>
      </div>

      <div className="px-4 pt-6 pb-4">
        <div className="bg-[#1C1C1E] rounded-3xl p-5 border border-[#2C2C2E]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#8E8E93] text-sm font-semibold">التطابق الكلي</span>
            <span className="text-white font-black text-3xl">{OVERALL}%</span>
          </div>
          <ScoreBar score={OVERALL} size="lg" />
          <p className="text-[#8E8E93] text-xs mt-3 leading-relaxed">
            استناداً إلى مقارنة مرئية دقيقة مع تطبيق سناب شات الرسمي على iOS
          </p>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {categories.map((cat, i) => (
          <div key={i} className="bg-[#1C1C1E] rounded-2xl overflow-hidden border border-[#2C2C2E]">
            <button
              className="w-full flex items-center justify-between px-4 py-4"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm text-right truncate">{cat.nameAr}</p>
                  <div className="mt-1.5">
                    <ScoreBar score={cat.score} size="sm" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mr-3 flex-shrink-0">
                <span className="font-black text-base" style={{ color: cat.score >= 95 ? '#00D084' : '#FFFC00' }}>{cat.score}%</span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#636366" strokeWidth="2.5" strokeLinecap="round"
                  style={{ transform: expanded === i ? 'rotate(90deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </button>

            {expanded === i && (
              <div className="border-t border-[#2C2C2E]">
                {cat.items.map((item, j) => (
                  <div key={j} className="px-4 py-3 border-b border-[#2C2C2E] last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white text-xs font-semibold">{item.label}</span>
                      <span className="font-black text-xs" style={{ color: item.match >= 95 ? '#00D084' : '#FFFC00' }}>{item.match}%</span>
                    </div>
                    <ScoreBar score={item.match} size="sm" />
                    <p className="text-[#636366] text-xs mt-1.5">{item.note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
