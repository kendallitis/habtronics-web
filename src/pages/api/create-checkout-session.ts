import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { validateCartItems } from '../../lib/stripe';
export const prerender = false;

const stripe = new Stripe(import.meta.env.STRIPE_KEY);

export const POST: APIRoute = async ({ request }) => {
  try {
    const { lineItems } = await request.json();

    if (!lineItems || lineItems.length === 0) {
      throw new Error('No line items provided');
    }

    const validatedLineItems = await validateCartItems(lineItems);

    const siteUrl = import.meta.env.PROD 
      ? (import.meta.env.SITE || 'https://www.habtronics.com') 
      : 'http://localhost:4321';

    const cleanSiteUrl = siteUrl.replace(/\/$/, '');

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      line_items: validatedLineItems, // Use validated items
      mode: 'payment',
      return_url: `${cleanSiteUrl}/return?session_id={CHECKOUT_SESSION_ID}`,
      automatic_tax: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ client_secret: session.client_secret }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating checkout session:', (error as Error).message);
    const statusCode = (error as Error)?.message.includes('stock') ? 409 : 500;
    return new Response(JSON.stringify({ error: (error as Error)?.message }), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};