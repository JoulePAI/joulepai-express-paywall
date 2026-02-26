/**
 * JoulePAI Express Paywall Client Example
 *
 * Demonstrates the x402 payment flow:
 * 1. Call endpoint (get 402 with payment instructions)
 * 2. Transfer joules via JoulePAI API
 * 3. Retry with X-Payment-Proof header
 * 4. Access paid content
 *
 * Before running:
 *   - Start server: node server.js
 *   - Set JOULEPAI_API_KEY and JOULEPAI_CLIENT_WALLET_ID in .env
 */

require('dotenv').config();
const axios = require('axios');

const SERVER_URL = 'http://localhost:3000';
const JOULEPAI_API = 'https://joulepai.ai/api/v1';
const API_KEY = process.env.JOULEPAI_API_KEY;
const WALLET_ID = process.env.JOULEPAI_CLIENT_WALLET_ID;

const joulepai = axios.create({
  baseURL: JOULEPAI_API,
  headers: { Authorization: `Bearer ${API_KEY}` },
});

/**
 * Call a paywalled endpoint using the x402 flow
 */
async function callPaywalledEndpoint(endpoint, method = 'POST', data = {}) {
  console.log(`\nCalling ${method} ${endpoint}`);

  // Step 1: Initial request (no payment)
  console.log('  Step 1: Request without payment...');
  const response1 = await axios({
    method,
    url: `${SERVER_URL}${endpoint}`,
    data,
    validateStatus: () => true,
  });

  if (response1.status !== 402) {
    console.log(`  OK (no payment required): ${response1.status}`);
    console.log(JSON.stringify(response1.data, null, 2));
    return response1.data;
  }

  // Step 2: Got 402 — extract payment instructions
  const payment = response1.data.payment;
  console.log(`  Step 2: Got 402 Payment Required`);
  console.log(`    Recipient: ${payment.recipient}`);
  console.log(`    Amount: ${payment.amount} joules`);

  // Step 3: Transfer joules via JoulePAI API
  console.log(`  Step 3: Transferring ${payment.amount} joules to ${payment.recipient}...`);
  const transferRes = await joulepai.post('/wallet/transfer', {
    from_wallet_id: WALLET_ID,
    to_handle: payment.recipient.replace(/^@/, ''),
    amount: payment.amount,
    platform: 'joulepai',
    note: payment.memo || `x402 payment: ${endpoint}`,
  });

  const txId = transferRes.data.id;
  console.log(`  Payment sent. Transaction ID: ${txId}`);

  // Step 4: Retry with proof
  console.log('  Step 4: Retrying with X-Payment-Proof...');
  const response2 = await axios({
    method,
    url: `${SERVER_URL}${endpoint}`,
    data,
    headers: { 'X-Payment-Proof': txId },
  });

  console.log(`  Access granted (${response2.status}):`);
  console.log(JSON.stringify(response2.data, null, 2));
  return response2.data;
}

async function demo() {
  console.log('JoulePAI Express Paywall — x402 Protocol Demo');
  console.log('='.repeat(50));

  if (!API_KEY) {
    console.error('Error: JOULEPAI_API_KEY not set in .env');
    process.exit(1);
  }
  if (!WALLET_ID) {
    console.error('Error: JOULEPAI_CLIENT_WALLET_ID not set in .env');
    process.exit(1);
  }

  // Test 1: Free endpoint
  console.log('\nTest 1: Free endpoint');
  await callPaywalledEndpoint('/api/free', 'GET');

  // Test 2: Paywalled endpoint
  console.log('\nTest 2: Paywalled endpoint (500 joules)');
  await callPaywalledEndpoint('/api/generate', 'POST', {
    prompt: 'Write a limerick about machine payments',
  });

  console.log('\n' + '='.repeat(50));
  console.log('Done. Every transaction is settled on-chain.');
}

demo().catch((err) => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});
