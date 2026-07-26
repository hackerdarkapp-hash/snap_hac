module.exports = function handler(req, res) {
  res.status(200).json({ error: "تحميل الكود غير متاح في هذه البيئة" });
};
