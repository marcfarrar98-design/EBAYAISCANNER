# Product AI Scanner V3.1

Mobile-first product scanner for UK eBay sellers.

### Flow
1. Take/upload product photo
2. Identify product with OpenAI vision
3. Extract and verify MPN/EAN
4. Search eBay UK via Browse API
5. Show market count, median, min/max
6. Generate an 80-character title and description
7. Calculate estimated net profit
8. Copy listing to eBay

API keys stay on the server. See `SETUP_FOR_MARC.md`.

The eBay Browse API supports keyword and GTIN searches and requires an application access token. See the official eBay Browse API documentation.
