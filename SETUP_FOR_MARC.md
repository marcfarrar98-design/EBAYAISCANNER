# Product AI Scanner V3.1 — get it running

## Fastest route: Render
1. Create a GitHub repository.
2. Upload everything inside this `v3` folder (not the outer folder itself).
3. In Render, choose **New → Blueprint** and select the repository.
4. Render will read `render.yaml` and install the app.
5. Open the service's **Environment** settings and enter:
   - `OPENAI_API_KEY` — your OpenAI API key
   - `EBAY_CLIENT_ID` — eBay Developer application Client ID
   - `EBAY_CLIENT_SECRET` — eBay Developer application Client Secret
6. Redeploy.
7. Open the Render URL on your Android phone.
8. Chrome menu → **Add to Home screen**.

## Local test
Node 20+ is required.

```bash
npm install
cp .env.example .env
npm start
```
Then open `http://localhost:8787`.

Without API keys the app runs in **Demo mode** so you can test the interface. It does NOT pretend demo identification is real.

## What V3.1 does
Photo → AI identification → identifier verification → eBay UK market research → price statistics → SEO title → description → profit calculation.

## eBay authentication
Market research uses the eBay Browse API application access token. Directly publishing to your seller account is deliberately separate and requires eBay user OAuth plus seller-side listing configuration.
