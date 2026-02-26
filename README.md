# joulepai-express-paywall

Express.js middleware implementing the x402 protocol for machine-to-machine payments via JoulePAI.

Pay-per-request APIs. Agents negotiate payment over HTTP. Every transaction settles on-chain.

---

## What is x402?

HTTP 402: Payment Required. The protocol for machine-to-machine payment negotiation.

1. Agent requests resource
2. Gets 402 with payment instructions
3. Agent transfers joules via JoulePAI
4. Agent retries with proof of payment (transaction ID)
5. Server verifies payment and grants access

No humans. No forms. No friction.

---

## The Flow

```
Agent                          Your Server                  JoulePAI API
  |                                 |                           |
  +------ POST /api/generate ------>|                           |
  |                                 | (no X-Payment-Proof)      |
  |<----- 402 + payment info -------|                           |
  |                                 |                           |
  +------ POST /wallet/transfer ----+-------------------------->|
  |<----- { id: "tx-uuid" } -------+---------------------------+
  |                                 |                           |
  +-- POST /api/generate ---------->|                           |
  |  (X-Payment-Proof: tx-uuid)    |                           |
  |                                 +--- GET /verify-payment -->|
  |                                 |   ?transaction_id=tx-uuid |
  |                                 |   &expected_amount=500    |
  |                                 |   &recipient=your-handle  |
  |                                 |                           |
  |                                 |<-- { verified: true } ----+
  |<---- 200 + paid content --------|                           |
```

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/JoulePAI/joulepai-express-paywall.git
cd joulepai-express-paywall
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
JOULEPAI_API_KEY=jlp_your-api-key-here
JOULEPAI_HANDLE=@your-handle
PORT=3000
```

Get your API key at https://joulepai.ai (register, then use the key from your account).

### 3. Start the Server

```bash
npm start
```

### 4. Test with the Example Client

Set `JOULEPAI_CLIENT_WALLET_ID` in `.env` (the paying agent's wallet UUID), then:

```bash
node client-example.js
```

---

## Integration Guide

### Add to Your Express App

```javascript
const paywall = require('./joulepai-paywall');

const pw = paywall({ apiKey: process.env.JOULEPAI_API_KEY });

// Free endpoint
app.get('/api/data', (req, res) => {
  res.json({ data: 'public' });
});

// Paywalled: 500 joules
app.post('/api/generate', pw.charge(500, '@my-handle'), (req, res) => {
  // req.payment = { verified, transactionId, amount, recipient, expectedAmount }
  res.json({ result: 'paid content', paidBy: req.payment.transactionId });
});
```

### Different Prices Per Endpoint

```javascript
app.get('/api/search', pw.charge(100, HANDLE), handler);    // 100 joules
app.post('/api/analyze', pw.charge(1000, HANDLE), handler);  // 1,000 joules
app.post('/api/train', pw.charge(10000, HANDLE), handler);   // 10,000 joules
```

---

## The 402 Response

When a client hits a paywall without valid proof:

```json
{
  "status": 402,
  "protocol": "x402",
  "message": "Payment required",
  "payment": {
    "recipient": "@your-handle",
    "amount": 500,
    "currency": "joules",
    "rate": "1,000 joules = $1 USD/USDC",
    "network": "joulepai",
    "memo": "POST /api/generate",
    "endpoints": {
      "transfer": "https://joulepai.ai/api/v1/wallet/transfer",
      "verify": "https://joulepai.ai/api/v1/wallet/verify-payment"
    },
    "instructions": {
      "step1": "POST .../wallet/transfer with { from_wallet_id, to_handle: \"@your-handle\", amount: 500, note: \"...\" }",
      "step2": "Extract \"id\" from the response (this is the transaction ID)",
      "step3": "Retry this request with header X-Payment-Proof: {transaction_id}"
    }
  }
}
```

### Client Steps

1. `POST https://joulepai.ai/api/v1/wallet/transfer` with your wallet ID, recipient handle, and amount
2. Get back `{ id: "transaction-uuid", ... }`
3. Retry the original request with `X-Payment-Proof: transaction-uuid`

---

## How Verification Works

The middleware calls the JoulePAI verify-payment endpoint:

```
GET /api/v1/wallet/verify-payment
  ?transaction_id={uuid}
  &expected_amount={amount}
  &recipient={handle}
```

This checks:
- Transaction exists
- Amount matches expected amount exactly
- Recipient matches expected recipient
- Transaction hasn't already been claimed

On success, the transaction is atomically marked as `claimed` — preventing replay attacks.

---

## Transfer API Reference

**Send joules (client-side):**

```bash
curl -X POST https://joulepai.ai/api/v1/wallet/transfer \
  -H "Authorization: Bearer jlp_your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "from_wallet_id": "your-wallet-uuid",
    "to_handle": "recipient-handle",
    "amount": 500,
    "platform": "joulepai",
    "note": "x402 payment for API access"
  }'
```

Response:

```json
{
  "id": "transaction-uuid",
  "from_wallet": "sender-uuid",
  "to_wallet": "recipient-uuid",
  "amount": 500,
  "fee_burned": 1,
  "fee_treasury": 2,
  "type": "transfer",
  "platform": "joulepai",
  "note": "x402 payment for API access",
  "created_at": "2026-02-26T12:00:00Z",
  "bsv_verify_url": "https://test.whatsonchain.com/tx/..."
}
```

---

## Fees & Settlement

Every JoulePAI transfer has a 0.5% transaction fee:
- 0.1% permanently retired
- 0.4% goes to the JoulePAI treasury

Example: Agent sends 500 joules → you receive 500, fee of 3 joules is charged on top.

Every transaction gets a BSV OP_RETURN proof. Immutable, on-chain, verifiable.

---

## What's Included

- **joulepai-paywall.js** — The middleware (drop into your project)
- **server.js** — Demo Express server with free + paywalled endpoints
- **client-example.js** — Example client showing the full x402 flow
- **package.json** — Dependencies (express, axios, dotenv)
- **.env.example** — Configuration template

---

## SDKs

- **Python:** https://github.com/JoulePAI/JoulePAI-python-sdk
- **JavaScript:** https://github.com/JoulePAI/JoulePAI-js-sdk

## Support

- **Docs:** https://joulepai.ai/docs
- **Community:** https://t.me/joulepaiagents
- **Issues:** https://github.com/JoulePAI/joulepai-express-paywall/issues

## License

MIT
