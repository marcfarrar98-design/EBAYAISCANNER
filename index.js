import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';

const app = express();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB';

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.get('/health', (_, res) => res.json({ ok: true, service: 'product-ai-scanner' }));

const json = (res, data) => res.json(data);
const imageDataUrl = file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

const IDENTIFY_PROMPT = `You are an exacting product-identification engine for UK e-commerce. Inspect the supplied product image. Read all visible text, model numbers, part numbers, barcodes and packaging. Never invent an MPN, EAN or GTIN. Return JSON only with: brand, product_name, model, mpn, ean, gtin, category, condition_observed, evidence_text, search_queries, confidence, identifiers. identifiers is an array of objects {type,value,status,evidence}; status must be observed, inferred, or not_found. If a barcode is visible but unreadable, say not_found. If several possible products exist, return the most likely and explain ambiguity in evidence_text.`;

async function aiJSON(system, userContent) {
  if (!openai) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const r = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }]
  });
  return JSON.parse(r.choices[0].message.content);
}

app.post('/api/identify', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image is required' });
    const identification = await aiJSON(IDENTIFY_PROMPT, [
      { type: 'text', text: 'Identify the exact product. Pay special attention to MPN/EAN/GTIN, manufacturer labels, model numbers and package text.' },
      { type: 'image_url', image_url: { url: imageDataUrl(req.file), detail: 'high' } }
    ]);
    const research = await researchEbay(identification);
    const listing = await generateListing(identification, research);
    const images = await imageSearch(identification);
    const pricing = calculatePricing(research, Number(req.body?.cost || 0), Number(req.body?.postage || 0));
    res.json({ identification, research, listing, pricing, images });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Scan failed' });
  }
});

app.post('/api/batch-identify', upload.array('images', 30), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'images are required' });
    const out = [];
    for (const file of req.files) {
      try {
        const identification = await aiJSON(IDENTIFY_PROMPT, [
          { type: 'text', text: 'Identify this product for an eBay UK listing.' },
          { type: 'image_url', image_url: { url: imageDataUrl(file), detail: 'high' } }
        ]);
        const research = await researchEbay(identification);
        const listing = await generateListing(identification, research);
        const pricing = calculatePricing(research, 0, 0);
        out.push({ identification, research, listing, pricing, ok: true });
      } catch (e) { out.push({ ok: false, error: e.message }); }
    }
    res.json({ results: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function generateListing(p, research) {
  return aiJSON(`Write a high-converting but factual UK eBay listing. Return JSON only: title, subtitle, description, keywords, category_suggestion, item_specifics. Title must be <=80 characters. Use only supported facts. Never invent compatibility, specifications, accessories, condition, warranty or contents. If an identifier is unverified, do not present it as verified.`, JSON.stringify({ identification: p, research }));
}

async function ebayAppToken() {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return null;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' })
  });
  if (!r.ok) throw new Error(`eBay token request failed: ${r.status}`);
  return (await r.json()).access_token;
}

async function researchEbay(p) {
  const token = await ebayAppToken();
  if (!token) return { available: false, reason: 'eBay API credentials not configured', items: [] };
  const q = [p.brand, p.product_name, p.model, p.mpn, p.ean || p.gtin].filter(Boolean).join(' ');
  if (!q) return { available: true, items: [], reason: 'No usable search identifier' };
  const u = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '20');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE } });
  if (!r.ok) return { available: false, reason: `eBay search failed: ${r.status}`, items: [] };
  const j = await r.json();
  const items = (j.itemSummaries || []).map(x => ({ title: x.title, price: Number(x.price?.value), currency: x.price?.currency, image: x.image?.imageUrl, itemId: x.itemId, url: x.itemWebUrl }));
  return { available: true, query: q, items, count: items.length };
}

function calculatePricing(research, cost, postage) {
  const prices = (research.items || []).map(x => x.price).filter(x => Number.isFinite(x) && x > 0).sort((a,b)=>a-b);
  if (!prices.length) return { marketLow: null, marketMedian: null, marketHigh: null, suggestedPrice: null, cost, postage, estimatedProfit: null, estimatedMargin: null };
  const median = prices[Math.floor(prices.length / 2)];
  const suggested = Math.round(median * 0.99 * 100) / 100;
  // eBay fee is deliberately a configurable estimate rather than a hard-coded promise.
  const feeRate = 0.13;
  const profit = suggested - cost - postage - suggested * feeRate;
  return { marketLow: prices[0], marketMedian: median, marketHigh: prices[prices.length-1], suggestedPrice: suggested, cost, postage, estimatedProfit: Math.round(profit*100)/100, estimatedMargin: Math.round((profit/suggested)*1000)/10, feeAssumption: feeRate };
}

async function imageSearch(p) {
  if (!process.env.SERPAPI_KEY) return [];
  const q = [p.brand, p.product_name, p.model, p.mpn, p.ean || p.gtin].filter(Boolean).join(' ');
  if (!q) return [];
  const u = new URL('https://serpapi.com/search.json');
  u.searchParams.set('engine', 'google_images'); u.searchParams.set('q', q); u.searchParams.set('api_key', process.env.SERPAPI_KEY);
  const r = await fetch(u); if (!r.ok) return [];
  const j = await r.json();
  return (j.images_results || []).slice(0, 8).map(x => ({ title:x.title, thumbnail:x.thumbnail, original:x.original, source:x.link }));
}

app.listen(process.env.PORT || 8080, () => console.log(`API listening on ${process.env.PORT || 8080}`));
