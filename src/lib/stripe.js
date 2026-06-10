/**
 * AuditPilot — Stripe client singleton
 * Import this module anywhere you need to call the Stripe API.
 */

const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] WARNING: STRIPE_SECRET_KEY is not set. Billing features will fail.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  // Timeout after 10 s so a slow Stripe response doesn't hang the server
  timeout: 10000
});

module.exports = stripe;
