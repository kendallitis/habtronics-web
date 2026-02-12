import Stripe from 'stripe';

const stripe = new Stripe(import.meta.env.STRIPE_KEY);

// In-memory cache
let cachedProducts: any[] | null = null;
let lastFetched = 0;
const CACHE_TTL = 1000 * 60 * 10; // 5 minutes

export async function getProductData() {
  const now = Date.now();

  // If cache is still valid, serve it
  if (cachedProducts && now - lastFetched < CACHE_TTL) {
    console.log('Serving cached product metadata...');
    return cachedProducts;
  }

  // Otherwise, fetch fresh from Stripe
  console.log('Fetching product metadata from Stripe...');
  const products = await stripe.products.list();

  const productMetadata = await Promise.all(
    products.data.map(async (product) => {
      const priceObj = typeof product.default_price === 'string'
        ? await stripe.prices.retrieve(product.default_price)
        : product.default_price;

      return {
        id: product.id,
        name: product.name,
        price_id: priceObj?.id, // Use optional chaining just in case
        price: (( (priceObj as any)?.unit_amount || 0) / 100).toFixed(2),
        image: product.images[0],
        image_array: product.images,
        metadata: product.metadata,
      };
    })
  );

  // Update cache
  cachedProducts = productMetadata;
  lastFetched = now;

  return productMetadata;
}

export async function validateCartItems(clientItems: { priceId: string; quantity: number }[]) {
  // Validate input structure
  if (!Array.isArray(clientItems) || clientItems.length === 0) {
    throw new Error('Invalid cart items');
  }

  const validatedLineItems = [];

  // Verify each item with fresh data from Stripe
  for (const item of clientItems) {
    if (!item.priceId || !item.quantity || item.quantity <= 0) {
      throw new Error('Invalid item data');
    }

    try {
      // Retrieve price and expand product to get fresh metadata (stock)
      const price = await stripe.prices.retrieve(item.priceId, {
        expand: ['product']
      });

      const product = price.product as Stripe.Product;
      
      // Stock check
      // Only check stock if the 'stock' metadata field exists
      if (product.metadata && 'stock' in product.metadata) {
        const availableStock = Number(product.metadata.stock);
        if (isNaN(availableStock)) {
           console.error(`Invalid stock value for product ${product.id}`);
           // Fallback or throw? Safest to block checkout if system is unsure.
           throw new Error(`Stock data error for ${product.name}`);
        }
        
        if (item.quantity > availableStock) {
           throw new Error(`Sorry, insufficient stock for ${product.name}. Available: ${availableStock}`);
        }
      }

      if (!product.active) {
         throw new Error(`Product ${product.name} is no longer available.`);
      }

      validatedLineItems.push({
        price: item.priceId,
        quantity: item.quantity
      });

    } catch (err: any) {
       // Re-throw specific errors (like stock), wrap others
       if (err.message.includes('insufficient stock') || err.message.includes('no longer available')) {
         throw err;
       }
       console.error(`Error validating item ${item.priceId}:`, err);
       throw new Error('Unable to validate cart items. Please try again.');
    }
  }

  return validatedLineItems;
}
