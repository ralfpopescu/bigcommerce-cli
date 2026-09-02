import { ResourceSpec } from '../resource';
import { metafields, batchMetafields } from './metafields';

const CHANNEL = 'channels/{channel_id}';

export const CHANNELS: ResourceSpec = {
  name: 'channels',
  describe: 'Manage channels',
  path: 'channels',
  style: 'v3-item',
  idLabel: 'channel',
  // Channels cannot be deleted — they are retired by setting status to inactive.
  ops: ['list', 'get', 'create', 'update'],
  fields: ['id', 'name', 'platform', 'type', 'status', 'is_listable_from_ui', 'date_created'],
  params: ['available', 'status', 'type', 'platform'],
  children: [
    {
      name: 'listings',
      describe: 'Product listings on a channel',
      path: `${CHANNEL}/listings`,
      style: 'v3-item',
      idLabel: 'listing',
      // The API updates listings as a batch on the collection, not one by one.
      ops: ['list', 'get', 'create'],
      fields: ['listing_id', 'channel_id', 'product_id', 'state', 'name', 'external_id'],
      actions: [
        {
          name: 'update',
          describe: 'Update listings in bulk',
          method: 'PUT',
          path: `v3/${CHANNEL}/listings`,
          body: true,
          done: 'Listings updated',
        },
      ],
    },
    {
      name: 'site',
      describe: 'The site a channel is served from',
      path: `${CHANNEL}/site`,
      style: 'v3-singleton',
      actions: [
        {
          name: 'create',
          describe: 'Attach a new site to this channel',
          method: 'POST',
          path: `v3/${CHANNEL}/site`,
          body: true,
          done: 'Site created',
        },
        {
          name: 'delete',
          describe: 'Detach the site from this channel',
          method: 'DELETE',
          path: `v3/${CHANNEL}/site`,
          done: 'Site deleted',
        },
        {
          name: 'set-checkout-url',
          describe: 'Point this channel’s checkout at another URL',
          method: 'PUT',
          path: `v3/${CHANNEL}/site/checkout-url`,
          body: true,
          done: 'Checkout URL set',
        },
        {
          name: 'clear-checkout-url',
          describe: 'Revert to the default checkout URL',
          method: 'DELETE',
          path: `v3/${CHANNEL}/site/checkout-url`,
          done: 'Checkout URL cleared',
        },
      ],
    },
    {
      name: 'menus',
      describe: 'Control-panel menu entries for a channel',
      path: `${CHANNEL}/channel-menus`,
      style: 'v3-item',
      ops: ['list', 'create'],
      idLabel: 'channel menu',
      actions: [
        {
          name: 'clear',
          describe: 'Remove this channel’s menu entries',
          method: 'DELETE',
          path: `v3/${CHANNEL}/channel-menus`,
          done: 'Channel menus deleted',
        },
      ],
    },
    {
      name: 'currency-assignments',
      describe: 'Currencies enabled on a channel',
      path: `${CHANNEL}/currency-assignments`,
      style: 'v3-singleton',
      actions: [
        {
          name: 'create',
          describe: 'Assign currencies to this channel',
          method: 'POST',
          path: `v3/${CHANNEL}/currency-assignments`,
          body: true,
          done: 'Currencies assigned',
        },
        {
          name: 'delete',
          describe: 'Remove this channel’s currency assignments',
          method: 'DELETE',
          path: `v3/${CHANNEL}/currency-assignments`,
          done: 'Currency assignments removed',
        },
      ],
    },
    {
      name: 'all-currency-assignments',
      describe: 'Currency assignments across every channel',
      path: 'channels/currency-assignments',
      style: 'v3-batch',
      ops: ['list', 'create', 'update'],
      idLabel: 'currency assignment',
      params: ['channel_id:in'],
    },
    {
      name: 'active-theme',
      describe: 'The theme a channel is rendering',
      path: `${CHANNEL}/active-theme`,
      style: 'v3-singleton',
      ops: ['get'],
    },
    metafields(CHANNEL),
    batchMetafields('channels/metafields'),
  ],
};

export const SITES: ResourceSpec = {
  name: 'sites',
  describe: 'Storefront sites and their routes',
  path: 'sites',
  style: 'v3-item',
  idLabel: 'site',
  fields: ['id', 'url', 'channel_id', 'created_at', 'updated_at'],
  params: ['channel_id:in', 'url'],
  children: [
    {
      name: 'routes',
      describe: 'Routes on a site',
      path: 'sites/{site_id}/routes',
      style: 'v3-item',
      idLabel: 'route',
      fields: ['id', 'type', 'matching', 'route'],
      params: ['type:in'],
      actions: [
        {
          name: 'upsert',
          describe: 'Replace this site’s routes in one call',
          method: 'PUT',
          path: 'v3/sites/{site_id}/routes',
          body: true,
          done: 'Routes updated',
        },
      ],
    },
    {
      name: 'certificate',
      describe: 'The SSL certificate on a site',
      path: 'sites/{site_id}/certificate',
      style: 'v3-singleton',
    },
    {
      name: 'certificates',
      describe: 'SSL certificates across every site',
      path: 'sites/certificates',
      style: 'v3-item',
      ops: ['list'],
      params: ['site_id:in'],
    },
  ],
};

export const INVENTORY: ResourceSpec = {
  name: 'inventory',
  describe: 'Manage inventory',
  actions: [
    {
      name: 'adjust-absolute',
      describe: 'Set absolute quantities in bulk',
      method: 'PUT',
      path: 'v3/inventory/adjustments/absolute',
      body: true,
      done: 'Absolute adjustment applied',
    },
    {
      name: 'adjust-relative',
      describe: 'Add to or subtract from quantities in bulk',
      method: 'POST',
      path: 'v3/inventory/adjustments/relative',
      body: true,
      done: 'Relative adjustment applied',
    },
  ],
  children: [
    {
      name: 'items',
      describe: 'Inventory items across locations',
      path: 'inventory/items',
      style: 'v3-item',
      ops: ['list'],
      fields: ['product_id', 'variant_id', 'sku', 'location_id', 'available_to_sell', 'total_inventory_onhand', 'is_in_stock'],
      params: ['location_id:in', 'sku:in', 'product_id:in', 'variant_id:in'],
    },
    {
      name: 'locations',
      describe: 'Inventory locations',
      path: 'inventory/locations',
      style: 'v3-batch',
      idLabel: 'location',
      fields: ['id', 'code', 'label', 'enabled', 'type_id', 'managed_by_external_source'],
      params: ['id:in', 'code:in', 'enabled', 'type_id:in'],
      children: [
        {
          name: 'items',
          describe: 'Inventory items at one location',
          path: 'inventory/locations/{location_id}/items',
          style: 'v3-item',
          ops: ['list'],
          fields: ['product_id', 'variant_id', 'sku', 'available_to_sell', 'total_inventory_onhand', 'safety_stock'],
          params: ['sku:in', 'product_id:in', 'variant_id:in'],
          actions: [
            {
              name: 'set',
              describe: 'Set safety stock and warning levels at this location',
              method: 'PUT',
              path: 'v3/inventory/locations/{location_id}/items',
              body: true,
              done: 'Location items updated',
            },
          ],
        },
        metafields('inventory/locations/{location_id}'),
        batchMetafields('inventory/locations/metafields'),
      ],
    },
  ],
};
