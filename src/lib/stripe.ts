const STRIPE_KEY = import.meta.env.STRIPE_KEY as string | undefined;

// In-memory cache
let cachedProducts: any[] | null = null;
let lastFetched = 0;
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

async function stripeFetch(path: string, init?: RequestInit) {
  if (!STRIPE_KEY) {
    throw new Error('Missing STRIPE_KEY environment variable');
  }

  const url = `https://api.stripe.com/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`Stripe returned non-JSON response (${res.status}): ${text}`);
  }

  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json) || text;
    throw new Error(`Stripe API error ${res.status}: ${msg}`);
  }

  return json;
}

export async function getProductData() {
  const now = Date.now();

  // If cache is still valid, serve it
  if (cachedProducts && now - lastFetched < CACHE_TTL) {
    console.log('Serving cached product metadata...');
    return cachedProducts;
  }

  // Otherwise, fetch fresh from Stripe using fetch (works on Edge/Cloudflare)
  console.log('Fetching product metadata from Stripe (fetch)...');
  const productsResp = await stripeFetch('/products?limit=100');
  const products = productsResp?.data || [];

  const productMetadata = await Promise.all(
    products.map(async (product: any) => {
      let priceObj: any = product.default_price;

      if (typeof product.default_price === 'string') {
        priceObj = await stripeFetch(`/prices/${encodeURIComponent(product.default_price)}`);
      }

      return {
        id: product.id,
        name: product.name,
        price_id: priceObj?.id,
        price: (((priceObj?.unit_amount ?? 0) as number) / 100).toFixed(2),
        image: product.images?.[0] ?? null,
        image_array: product.images ?? [],
        metadata: product.metadata ?? {},
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

  const validatedLineItems: { price: string; quantity: number }[] = [];

  // Verify each item with fresh data from Stripe (fetch)
  for (const item of clientItems) {
    if (!item.priceId || !item.quantity || item.quantity <= 0) {
      throw new Error('Invalid item data');
    }

    let price: any;
    try {
      price = await stripeFetch(`/prices/${encodeURIComponent(item.priceId)}?expand[]=product`);
    } catch (err: any) {
      console.error(`Error retrieving price ${item.priceId}:`, err?.message || err);
      throw new Error('Unable to validate cart items. Please try again.');
    }

    const product = price.product as any;

    // Stock check
    if (product?.metadata && 'stock' in product.metadata) {
      const availableStock = Number(product.metadata.stock);
      if (isNaN(availableStock)) {
        console.error(`Invalid stock value for product ${product.id}`);
        throw new Error(`Stock data error for ${product.name}`);
      }
      if (item.quantity > availableStock) {
        throw new Error(`Sorry, insufficient stock for ${product.name}. Available: ${availableStock}`);
      }
    }

    if (!product?.active) {
      throw new Error(`Product ${product?.name || item.priceId} is no longer available.`);
    }

    validatedLineItems.push({
      price: item.priceId,
      quantity: item.quantity,
    });
  }

  return validatedLineItems;
}
