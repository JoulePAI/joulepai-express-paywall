/**
 * JoulePAI Express Paywall Middleware
 * Implements x402 protocol: machine-to-machine payment negotiation over HTTP
 *
 * Usage:
 *   const paywall = require('./joulepai-paywall');
 *   const pw = paywall({ apiKey: process.env.JOULEPAI_API_KEY });
 *   app.post('/api/generate', pw.charge(500, '@my-handle'), handler);
 */

const axios = require('axios');

const JOULEPAI_BASE = 'https://joulepai.ai/api/v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_USED_TX = 10000;
const DEFAULT_VERIFY_RPM = 30;

/**
 * Create a paywall instance with server-side API key
 * @param {object} opts
 * @param {string} opts.apiKey - Your JoulePAI API key (server-side, for verify-payment)
 * @param {number} [opts.verifyRateLimit] - Max verification API calls per minute (default 30)
 * @returns {object} { charge }
 */
function paywall({ apiKey, verifyRateLimit }) {
  if (!apiKey) {
    throw new Error('joulepai-paywall: apiKey is required for payment verification');
  }

  const api = axios.create({
    baseURL: JOULEPAI_BASE,
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
  });

  // Track claimed transaction IDs — capped to prevent memory leaks
  const usedTxIds = new Set();

  // Sliding-window rate limiter for verification API calls
  const rpmLimit = verifyRateLimit || DEFAULT_VERIFY_RPM;
  const verifyTimestamps = [];

  function isVerifyRateLimited() {
    const now = Date.now();
    const windowStart = now - 60000;
    while (verifyTimestamps.length && verifyTimestamps[0] < windowStart) {
      verifyTimestamps.shift();
    }
    if (verifyTimestamps.length >= rpmLimit) return true;
    verifyTimestamps.push(now);
    return false;
  }

  /**
   * Create a charge middleware for a route
   * @param {number} amount - Cost in joules
   * @param {string} recipient - Your wallet handle (e.g., '@architect')
   * @returns {Function} Express middleware
   */
  function charge(amount, recipient) {
    const paymentInfo = {
      recipient,
      amount,
      currency: 'joules',
      rate: '1,000 joules = $1 USD/USDC',
      network: 'joulepai',
      endpoints: {
        transfer: `${JOULEPAI_BASE}/wallet/transfer`,
        verify: `${JOULEPAI_BASE}/wallet/verify-payment`,
      },
    };

    return async (req, res, next) => {
      const txId = req.get('X-Payment-Proof');

      if (!txId) {
        return res.status(402).json({
          status: 402,
          protocol: 'x402',
          message: 'Payment required',
          payment: {
            ...paymentInfo,
            memo: `${req.method} ${req.path}`,
            instructions: {
              step1: `POST ${JOULEPAI_BASE}/wallet/transfer with { from_wallet_id, to_handle: "${recipient}", amount: ${amount}, note: "..." }`,
              step2: 'Extract "id" from the response (this is the transaction ID)',
              step3: 'Retry this request with header X-Payment-Proof: {transaction_id}',
            },
          },
        });
      }

      // Validate UUID format before making any API calls
      if (!UUID_RE.test(txId)) {
        return res.status(402).json({
          status: 402,
          protocol: 'x402',
          error: 'Invalid transaction ID format',
          payment: paymentInfo,
        });
      }

      // Local replay check
      if (usedTxIds.has(txId)) {
        return res.status(402).json({
          status: 402,
          protocol: 'x402',
          error: 'Transaction already used',
          payment: paymentInfo,
        });
      }

      // Rate limit verification API calls
      if (isVerifyRateLimited()) {
        return res.status(429).json({
          status: 429,
          error: 'Too many verification attempts, try again shortly',
        });
      }

      // Verify via JoulePAI API
      try {
        const cleanRecipient = recipient.replace(/^@/, '');
        const { data } = await api.get('/wallet/verify-payment', {
          params: {
            transaction_id: txId,
            expected_amount: amount,
            recipient: cleanRecipient,
          },
        });

        if (!data.verified) {
          return res.status(402).json({
            status: 402,
            protocol: 'x402',
            error: data.reason || 'Payment not verified',
            already_claimed: data.already_claimed || false,
            payment: paymentInfo,
          });
        }

        // Mark as used locally — evict oldest entries if at capacity
        if (usedTxIds.size >= MAX_USED_TX) {
          const oldest = usedTxIds.values().next().value;
          usedTxIds.delete(oldest);
        }
        usedTxIds.add(txId);

        // Attach payment info to request
        req.payment = {
          verified: true,
          transactionId: txId,
          amount: data.actual_amount,
          recipient: data.actual_recipient,
          expectedAmount: data.expected_amount,
        };

        next();
      } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        console.error(`[joulepai-paywall] verify failed: ${status} ${detail || err.message}`);

        return res.status(402).json({
          status: 402,
          protocol: 'x402',
          error: detail || 'Payment verification failed',
          payment: paymentInfo,
        });
      }
    };
  }

  return { charge };
}

module.exports = paywall;
