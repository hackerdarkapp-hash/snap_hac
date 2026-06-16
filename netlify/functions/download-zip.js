export const handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'تحميل الكود غير متاح في هذه البيئة' }),
  };
};
