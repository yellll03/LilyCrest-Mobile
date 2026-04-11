const { getDb } = require('../config/database');

// Get all FAQs
async function getAllFaqs(req, res) {
  try {
    const { category } = req.query;
    const query = category ? { category } : {};
    const db = getDb();
    const faqs = await db.collection('faqs').find(query).toArray();
    res.json(faqs.map(f => ({ ...f, _id: undefined })));
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch FAQs' });
  }
}

// Get distinct FAQ categories
async function getFAQCategories(req, res) {
  try {
    const db = getDb();
    const categories = await db.collection('faqs').distinct('category');
    res.json({ categories: categories.filter(Boolean).sort() });
  } catch (error) {
    res.status(500).json({ detail: 'Failed to fetch FAQ categories' });
  }
}

module.exports = {
  getAllFaqs,
  getFAQCategories,
};
