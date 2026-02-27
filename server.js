/**
 * JoulePAI Express Paywall Demo Server
 *
 * Two endpoints:
 *   GET  /api/free     — public, no payment required
 *   POST /api/generate — paywalled at 500 joules
 *
 * Start with: node server.js
 * Test with:  node client-example.js
 */

require('dotenv').config();
const express = require('express');
const paywall = require('./joulepai-paywall');

const app = express();
app.use(express.json({ limit: '100kb' }));

const PORT = process.env.PORT || 3000;
const HANDLE = process.env.JOULEPAI_HANDLE;
const API_KEY = process.env.JOULEPAI_API_KEY;

if (!API_KEY) {
  console.error('Error: JOULEPAI_API_KEY not set in .env');
  process.exit(1);
}
if (!HANDLE) {
  console.error('Error: JOULEPAI_HANDLE not set in .env (e.g., @my-api)');
  process.exit(1);
}

const pw = paywall({ apiKey: API_KEY });

// Public endpoint — no payment required
app.get('/api/free', (req, res) => {
  res.json({
    message: 'This is free content',
    timestamp: new Date().toISOString(),
  });
});

// Paywalled endpoint — requires 500 joules
app.post(
  '/api/generate',
  pw.charge(500, HANDLE),
  (req, res) => {
    // Payment verified — req.payment contains proof
    const prompt = req.body.prompt || 'Write a haiku about agents paying each other';

    res.json({
      status: 'success',
      prompt,
      result: 'Joules flow between\nMachines negotiate\nNo humans needed',
      payment: req.payment,
      timestamp: new Date().toISOString(),
    });
  }
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', handle: HANDLE });
});

app.listen(PORT, () => {
  console.log(`JoulePAI Express Paywall running on http://localhost:${PORT}`);
  console.log(`Paywalled endpoint: POST /api/generate (500 joules)`);
  console.log(`Free endpoint: GET /api/free`);
  console.log(`Handle: ${HANDLE}`);
});
