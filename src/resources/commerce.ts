import { ResourceSpec } from '../resource';
import { metafields } from './metafields';

const CART = 'carts/{cart_id}';
const CHECKOUT = 'checkouts/{checkout_id}';

export const CARTS: ResourceSpec = {
  name: 'carts',
  describe: 'Server-to-server carts',
  path: 'carts',
  style: 'v3-item',
  idLabel: 'cart',
  // There is no list endpoint — a cart is only reachable by its ID.
  ops: ['get', 'create', 'update', 'delete'],
  params: ['include'],
  actions: [
    {
      name: 'redirect-urls',
      describe: 'Mint storefront URLs that hand a cart to a shopper',
      method: 'POST',
      path: `v3/${CART}/redirect_urls`,
      params: ['include'],
    },
  ],
  children: [
    {
      name: 'items',
      describe: 'Cart line items',
      path: `${CART}/items`,
      style: 'v3-item',
      idLabel: 'cart item',
      ops: ['create', 'update', 'delete'],
      params: ['include'],
    },
    {
      name: 'settings',
      describe: 'Store-wide cart settings',
      path: 'carts/settings',
      style: 'v3-singleton',
      children: [
        {
          name: 'channel',
          describe: 'Per-channel cart settings',
          path: 'carts/settings/channels/{channel_id}',
          style: 'v3-singleton',
        },
      ],
    },
    metafields(CART),
  ],
};

export const CHECKOUTS: ResourceSpec = {
  name: 'checkouts',
  describe: 'Server-to-server checkouts',
  path: 'checkouts',
  style: 'v3-item',
  idLabel: 'checkout',
  ops: ['get', 'update'],
  params: ['include'],
  actions: [
    {
      name: 'order',
      describe: 'Turn a checkout into an order',
      method: 'POST',
      path: `v3/${CHECKOUT}/orders`,
      done: 'Order created',
    },
    {
      name: 'token',
      describe: 'Mint an embedded-checkout token',
      method: 'POST',
      path: `v3/${CHECKOUT}/token`,
    },
    {
      name: 'discount',
      describe: 'Apply a manual discount',
      method: 'POST',
      path: `v3/${CHECKOUT}/discounts`,
      body: true,
      done: 'Discount applied',
    },
  ],
  children: [
    {
      name: 'billing-address',
      describe: 'Checkout billing address',
      path: `${CHECKOUT}/billing-address`,
      style: 'v3-item',
      idLabel: 'billing address',
      ops: ['create', 'update'],
    },
    {
      name: 'consignments',
      describe: 'Checkout consignments',
      path: `${CHECKOUT}/consignments`,
      style: 'v3-item',
      idLabel: 'consignment',
      ops: ['create', 'update', 'delete'],
      params: ['include'],
    },
    {
      name: 'coupons',
      describe: 'Coupons on a checkout',
      path: `${CHECKOUT}/coupons`,
      style: 'v3-item',
      idLabel: 'coupon code',
      ops: ['create', 'delete'],
    },
    {
      name: 'settings',
      describe: 'Store-wide checkout settings',
      path: 'checkouts/settings',
      style: 'v3-singleton',
    },
  ],
};

export const PAYMENTS: ResourceSpec = {
  name: 'payments',
  describe: 'Payment methods, tokens, and stored instruments',
  actions: [
    {
      name: 'access-token',
      describe: 'Mint a Payment Access Token for processing a charge',
      method: 'POST',
      path: 'v3/payments/access_tokens',
      body: true,
    },
  ],
  children: [
    {
      name: 'methods',
      describe: 'Payment methods accepted for an order or checkout',
      path: 'payments/methods',
      style: 'v3-item',
      ops: ['list'],
      // The API requires one of these; without either it answers 422.
      params: ['order_id', 'checkout_id'],
      fields: ['id', 'name', 'test_mode', 'type', 'supported_instruments'],
      actions: [
        {
          name: 'legacy',
          describe: 'Accepted payment methods (legacy V2)',
          method: 'GET',
          path: 'v2/payments/methods',
          envelope: false,
          fields: ['code', 'name', 'test_mode'],
        },
      ],
    },
    {
      name: 'stored-instruments',
      describe: 'Stored payment instruments',
      path: 'payments/stored-instruments',
      style: 'v3-batch',
      idLabel: 'stored instrument',
      fields: ['token', 'type', 'brand', 'last_four', 'expiry_month', 'expiry_year', 'customer_id'],
      params: ['customer_id', 'payment_method_id'],
      actions: [
        {
          name: 'access-token',
          describe: 'Mint a token for vaulting an instrument',
          method: 'POST',
          path: 'v3/payments/stored-instruments/access-tokens',
          body: true,
        },
        {
          name: 'methods',
          describe: 'Payment methods that support vaulting',
          method: 'GET',
          path: 'v3/payments/stored-instruments/methods',
        },
        {
          name: 'unvault',
          describe: 'Permanently remove one stored instrument',
          method: 'DELETE',
          path: 'v3/payments/stored-instruments/{instrument_token}',
          args: ['instrument_token'],
          done: 'Instrument unvaulted',
        },
      ],
    },
  ],
};

export const PRICELISTS: ResourceSpec = {
  name: 'pricelists',
  describe: 'Price lists',
  path: 'pricelists',
  style: 'v3-item',
  idLabel: 'price list',
  ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
  fields: ['id', 'name', 'active', 'date_created', 'date_modified'],
  params: ['id:in', 'name', 'date_created'],
  actions: [
    {
      name: 'upsert-records',
      describe: 'Upsert records across price lists in one call',
      method: 'PUT',
      path: 'v3/pricelists/records',
      body: true,
      done: 'Records upserted',
    },
  ],
  children: [
    {
      name: 'records',
      describe: 'Price list records',
      path: 'pricelists/{price_list_id}/records',
      style: 'v3-item',
      idLabel: 'record',
      ops: ['list', 'get'],
      fields: ['variant_id', 'product_id', 'sku', 'currency', 'price', 'sale_price', 'retail_price'],
      params: ['variant_id:in', 'product_id:in', 'currency', 'sku:in'],
      actions: [
        {
          name: 'upsert',
          describe: 'Upsert records into this price list',
          method: 'PUT',
          path: 'v3/pricelists/{price_list_id}/records',
          body: true,
          done: 'Records upserted',
        },
        {
          name: 'clear',
          describe: 'Delete every record in this price list',
          method: 'DELETE',
          path: 'v3/pricelists/{price_list_id}/records',
          done: 'Records deleted',
        },
        {
          name: 'get-currency',
          describe: 'Get one variant’s price in one currency',
          method: 'GET',
          path: 'v3/pricelists/{price_list_id}/records/{variant_id}/{currency_code}',
          args: ['variant_id', 'currency_code'],
        },
        {
          name: 'set',
          describe: 'Set one variant’s price in one currency',
          method: 'PUT',
          path: 'v3/pricelists/{price_list_id}/records/{variant_id}/{currency_code}',
          args: ['variant_id', 'currency_code'],
          body: true,
          done: 'Record set',
        },
        {
          name: 'remove',
          describe: 'Delete one variant’s price in one currency',
          method: 'DELETE',
          path: 'v3/pricelists/{price_list_id}/records/{variant_id}/{currency_code}',
          args: ['variant_id', 'currency_code'],
          done: 'Record deleted',
        },
      ],
    },
    {
      name: 'assignments',
      describe: 'Price list assignments to customer groups and channels',
      path: 'pricelists/assignments',
      style: 'v3-batch',
      idLabel: 'assignment',
      ops: ['list', 'create', 'delete'],
      fields: ['id', 'price_list_id', 'customer_group_id', 'channel_id'],
      params: ['price_list_id:in', 'customer_group_id:in', 'channel_id:in'],
      actions: [
        {
          name: 'set',
          describe: 'Replace the assignments for one price list',
          method: 'PUT',
          path: 'v3/pricelists/{price_list_id}/assignments',
          body: true,
          done: 'Assignments set',
        },
      ],
    },
  ],
};

export const PROMOTIONS: ResourceSpec = {
  name: 'promotions',
  describe: 'Cart-level promotions',
  path: 'promotions',
  style: 'v3-item',
  idLabel: 'promotion',
  ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
  fields: ['id', 'name', 'status', 'redemption_type', 'start_date', 'end_date', 'current_uses'],
  params: ['status', 'name', 'redemption_type', 'channels', 'currency_code', 'sort'],
  actions: [
    {
      name: 'archive',
      describe: 'Archive promotions in bulk',
      method: 'POST',
      path: 'v3/promotions/archive',
      body: true,
      done: 'Promotions archived',
    },
    {
      name: 'unarchive',
      describe: 'Restore archived promotions',
      method: 'POST',
      path: 'v3/promotions/unarchive',
      body: true,
      done: 'Promotions unarchived',
    },
    {
      name: 'delete-code',
      describe: 'Delete a coupon code by the code itself',
      method: 'DELETE',
      path: 'v3/promotions/codes',
      params: ['code', 'promotion_id'],
      done: 'Coupon code deleted',
    },
    {
      name: 'find-code',
      describe: 'Look up a coupon code across promotions',
      method: 'GET',
      path: 'v3/promotions/codes',
      params: ['code', 'promotion_id'],
    },
  ],
  children: [
    {
      name: 'codes',
      describe: 'Coupon codes on a promotion',
      path: 'promotions/{promotion_id}/codes',
      style: 'v3-item',
      idLabel: 'code',
      ops: ['list', 'create', 'delete', 'delete-many'],
      fields: ['id', 'code', 'created', 'current_uses', 'max_uses'],
      actions: [
        {
          name: 'generate',
          describe: 'Generate a batch of coupon codes',
          method: 'POST',
          path: 'v3/promotions/{promotion_id}/codegen',
          body: true,
          done: 'Code batch queued',
        },
      ],
    },
    {
      name: 'settings',
      describe: 'Global promotion settings',
      path: 'promotions/settings',
      style: 'v3-singleton',
    },
  ],
};

export const ABANDONED_CARTS: ResourceSpec = {
  name: 'abandoned-carts',
  describe: 'Abandoned carts',
  actions: [
    {
      name: 'get',
      describe: 'Get an abandoned cart by its token',
      method: 'GET',
      path: 'v3/abandoned-carts/{token}',
      args: ['token'],
    },
  ],
  children: [
    {
      name: 'settings',
      describe: 'Abandoned cart settings',
      path: 'abandoned-carts/settings',
      style: 'v3-singleton',
      children: [
        {
          name: 'channel',
          describe: 'Per-channel abandoned cart settings',
          path: 'abandoned-carts/settings/channels/{channel_id}',
          style: 'v3-singleton',
        },
      ],
    },
  ],
};
