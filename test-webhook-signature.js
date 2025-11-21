#!/usr/bin/env node
/**
 * Test script to verify Cashfree webhook signature verification
 * 
 * Usage:
 *   node test-webhook-signature.js [timestamp] [secret_key] [payload]
 * 
 * Or without args to use sample test data:
 *   node test-webhook-signature.js
 */

const crypto = require('crypto');

// Sample payload from Cashfree documentation
const SAMPLE_PAYLOAD = {
  "data": {
    "order": {
      "order_id": "order_test_001",
      "order_amount": 100,
      "order_currency": "INR"
    },
    "payment": {
      "cf_payment_id": "1453002795",
      "payment_status": "SUCCESS",
      "payment_amount": 100,
      "payment_currency": "INR"
    },
    "customer_details": {
      "customer_name": "Test User",
      "customer_id": "test_user_123",
      "customer_email": "test@example.com",
      "customer_phone": "9999999999"
    }
  },
  "event_time": "2025-01-15T12:20:29+05:30",
  "type": "PAYMENT_SUCCESS_WEBHOOK"
};

// Sample values for testing
const SAMPLE_TIMESTAMP = Math.floor(Date.now() / 1000).toString();
const SAMPLE_SECRET = 'test_secret_key_12345';

function verifyWebhookSignature(timestamp, rawBody, signature, secretKey) {
  // Correct format per Cashfree API v2025-01-01
  // Direct concatenation: timestamp + rawBody
  const signatureString = timestamp + rawBody;
  const computedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(signatureString)
    .digest('base64');
  
  return computedSignature === signature;
}

function generateSignature(timestamp, rawBody, secretKey) {
  const signatureString = timestamp + rawBody;
  return crypto
    .createHmac('sha256', secretKey)
    .update(signatureString)
    .digest('base64');
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  Cashfree Webhook Signature Verification Test             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Parse command line arguments
const args = process.argv.slice(2);
let timestamp = args[0];
let secret = args[1];
let payload = args[2];

// Use defaults if not provided
if (!timestamp) {
  timestamp = SAMPLE_TIMESTAMP;
  console.log('ℹ️  Using sample timestamp (current epoch seconds)');
}
if (!secret) {
  secret = SAMPLE_SECRET;
  console.log('ℹ️  Using sample secret key');
}
if (!payload) {
  payload = JSON.stringify(SAMPLE_PAYLOAD);
  console.log('ℹ️  Using sample payload from Cashfree documentation\n');
}

console.log('📋 Test Data:');
console.log('─────────────────────────────────────────────────────────────');
console.log('Timestamp:', timestamp);
console.log('Secret Key:', secret);
console.log('Payload length:', payload.length, 'bytes');
console.log('Payload:', payload.substring(0, 100) + '...\n');

// Generate signature
const signature = generateSignature(timestamp, payload, secret);

console.log('🔐 Signature Generation:');
console.log('─────────────────────────────────────────────────────────────');
console.log('Message to sign: (timestamp + rawBody)');
console.log('Message length:', (timestamp + payload).length, 'bytes');
console.log('Algorithm: HMAC-SHA256');
console.log('Encoding: Base64');
console.log('Generated Signature:', signature);
console.log('');

// Test verification
console.log('✅ Verification Test:');
console.log('─────────────────────────────────────────────────────────────');

const isValid = verifyWebhookSignature(timestamp, payload, signature, secret);

if (isValid) {
  console.log('✓ Signature verification: PASSED');
  console.log('✓ The signature matches!');
} else {
  console.log('✗ Signature verification: FAILED');
  console.log('✗ The signature does not match!');
}

console.log('');
console.log('📝 Use in your endpoint:');
console.log('─────────────────────────────────────────────────────────────');
console.log(`
const crypto = require('crypto');

const sig = event.headers['x-webhook-signature'];
const ts = event.headers['x-webhook-timestamp'];
const rawBody = event.body; // Raw body as string/buffer

const SECRET = process.env.CASHFREE_SECRET_KEY;
const signatureString = ts + rawBody;
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(signatureString)
  .digest('base64');

if (expected === sig) {
  // Signature is valid ✓
}
`);

console.log('');
console.log('🧪 Curl Test Command:');
console.log('─────────────────────────────────────────────────────────────');
console.log(`
curl -X POST http://localhost:8888/api/cf-webhook \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-timestamp: ${timestamp}" \\
  -H "x-webhook-signature: ${signature}" \\
  -H "x-webhook-version: 2025-01-01" \\
  -d '${payload}'
`);

console.log('\n✨ Test complete!\n');
