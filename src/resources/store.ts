import { ResourceSpec } from '../resource';

/** Most settings endpoints are one object per store, overridable per channel. */
function setting(name: string, describe: string, path: string): ResourceSpec {
  return { name, describe, path, style: 'v3-singleton', params: ['channel_id'] };
}

export const SETTINGS: ResourceSpec = {
  name: 'settings',
  describe: 'Store and storefront settings',
  children: [
    setting('catalog', 'Catalog settings', 'settings/catalog'),
    setting('email-statuses', 'Transactional email statuses', 'settings/email-statuses'),
    setting('inventory', 'Inventory settings', 'settings/inventory'),
    setting('inventory-notifications', 'Inventory notification settings', 'settings/inventory/notifications'),
    setting('logo', 'Storefront logo', 'settings/logo'),
    setting('locale', 'Store locale', 'settings/store/locale'),
    setting('profile', 'Store profile', 'settings/store/profile'),
    setting('units-of-measurement', 'Units of measurement', 'settings/store/units-of-measurement'),
    setting('category', 'Storefront category settings', 'settings/storefront/category'),
    setting('product', 'Storefront product settings', 'settings/storefront/product'),
    setting('robotstxt', 'robots.txt', 'settings/storefront/robotstxt'),
    setting('search', 'Storefront search settings', 'settings/storefront/search'),
    setting('security', 'Storefront security settings', 'settings/storefront/security'),
    setting('seo', 'Storefront SEO settings', 'settings/storefront/seo'),
    setting('status', 'Storefront status — the maintenance switch’s messages', 'settings/storefront/status'),
    {
      name: 'analytics',
      describe: 'Web analytics providers',
      path: 'settings/analytics',
      style: 'v3-item',
      idLabel: 'analytics provider',
      ops: ['list', 'get', 'update'],
      fields: ['id', 'name', 'code', 'enabled'],
    },
    {
      name: 'filters',
      describe: 'Product filtering',
      path: 'settings/search/filters',
      style: 'v3-singleton',
      params: ['channel_id'],
      actions: [
        {
          name: 'available',
          describe: 'List filters this store could enable',
          method: 'GET',
          path: 'v3/settings/search/filters/available',
          params: ['channel_id'],
        },
        {
          name: 'contexts',
          describe: 'Get contextual filter overrides',
          method: 'GET',
          path: 'v3/settings/search/filters/contexts',
          params: ['channel_id'],
        },
        {
          name: 'set-contexts',
          describe: 'Set contextual filter overrides',
          method: 'PUT',
          path: 'v3/settings/search/filters/contexts',
          body: true,
          done: 'Filter contexts updated',
        },
      ],
    },
    {
      name: 'images',
      describe: 'Logo and favicon uploads',
      actions: [
        {
          name: 'logo',
          describe: 'Upload the storefront logo',
          method: 'POST',
          path: 'v3/settings/logo/image',
          upload: { field: 'LogoFile' },
          params: ['channel_id'],
          done: 'Logo uploaded',
        },
        {
          name: 'favicon',
          describe: 'Upload the storefront favicon',
          method: 'POST',
          path: 'v3/settings/favicon/image',
          upload: { field: 'FaviconFile' },
          params: ['channel_id'],
          done: 'Favicon uploaded',
        },
      ],
    },
  ],
};

export const STORE: ResourceSpec = {
  name: 'store',
  describe: 'Store information and system logs',
  actions: [
    {
      name: 'info',
      describe: 'Get store profile, plan, features, and enabled currencies',
      method: 'GET',
      path: 'v2/store',
      envelope: false,
    },
    {
      name: 'time',
      describe: 'Get BigCommerce server time',
      method: 'GET',
      path: 'v2/time',
      envelope: false,
    },
  ],
  children: [
    {
      name: 'logs',
      describe: 'Store system logs',
      path: 'store/systemlogs',
      style: 'v3-item',
      ops: ['list'],
      fields: ['id', 'severity', 'module', 'summary', 'date_created'],
      params: ['severity', 'module', 'date_created:min', 'date_created:max', 'sort'],
    },
  ],
};

export const CURRENCIES: ResourceSpec = {
  name: 'currencies',
  describe: 'Store currencies',
  path: 'currencies',
  style: 'v2-item',
  idLabel: 'currency',
  ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
  fields: ['id', 'name', 'currency_code', 'currency_exchange_rate', 'is_default', 'enabled'],
};

export const TAX: ResourceSpec = {
  name: 'tax',
  describe: 'Tax zones, rates, classes, and providers',
  children: [
    {
      name: 'zones',
      describe: 'Tax zones',
      path: 'tax/zones',
      style: 'v3-batch',
      idLabel: 'tax zone',
      fields: ['id', 'name', 'enabled', 'price_display_settings', 'shopper_target_settings'],
      params: ['id:in'],
    },
    {
      name: 'rates',
      describe: 'Tax rates',
      path: 'tax/rates',
      style: 'v3-batch',
      idLabel: 'tax rate',
      fields: ['id', 'name', 'enabled', 'tax_zone_id', 'class_rates'],
      params: ['id:in', 'tax_zone_id:in'],
    },
    {
      name: 'classes',
      describe: 'Tax classes',
      path: 'tax_classes',
      style: 'v2-item',
      ops: ['list', 'get'],
      idLabel: 'tax class',
      fields: ['id', 'name'],
    },
    {
      name: 'settings',
      describe: 'Tax settings',
      path: 'tax/settings',
      style: 'v3-singleton',
    },
    {
      name: 'properties',
      describe: 'Tax properties',
      path: 'tax/properties',
      style: 'v3-batch',
      idLabel: 'tax property',
      fields: ['id', 'code', 'display_name', 'description'],
      params: ['id:in', 'code:in'],
    },
    {
      name: 'product-properties',
      describe: 'Tax properties assigned to products',
      path: 'tax/products/properties',
      style: 'v3-batch',
      idLabel: 'product tax property',
      ops: ['list', 'update', 'delete'],
      deleteQuery: 'product_id:in',
      fields: ['product_id', 'tax_properties'],
      params: ['product_id:in'],
    },
    {
      name: 'provider',
      describe: 'A tax provider’s connection to this store',
      path: 'tax/providers/{provider_id}/connection',
      style: 'v3-singleton',
      actions: [
        {
          name: 'disconnect',
          describe: 'Remove the provider connection',
          method: 'DELETE',
          path: 'v3/tax/providers/{provider_id}/connection',
          done: 'Provider disconnected',
        },
      ],
    },
  ],
};

export const SHIPPING: ResourceSpec = {
  name: 'shipping',
  describe: 'Shipping zones, methods, and carriers',
  actions: [
    {
      name: 'connect-carrier',
      describe: 'Connect a shipping carrier',
      method: 'POST',
      path: 'v2/shipping/carrier/connection',
      body: true,
      envelope: false,
      done: 'Carrier connected',
    },
    {
      name: 'update-carrier',
      describe: 'Update a carrier connection',
      method: 'PUT',
      path: 'v2/shipping/carrier/connection',
      body: true,
      envelope: false,
      done: 'Carrier connection updated',
    },
    {
      name: 'disconnect-carrier',
      describe: 'Disconnect a shipping carrier',
      method: 'DELETE',
      path: 'v2/shipping/carrier/connection',
      envelope: false,
      done: 'Carrier disconnected',
    },
  ],
  children: [
    {
      name: 'zones',
      describe: 'Shipping zones',
      path: 'shipping/zones',
      style: 'v2-item',
      idLabel: 'shipping zone',
      fields: ['id', 'name', 'type', 'enabled', 'free_shipping'],
      children: [
        {
          name: 'methods',
          describe: 'Shipping methods in a zone',
          path: 'shipping/zones/{zone_id}/methods',
          style: 'v2-item',
          idLabel: 'shipping method',
          fields: ['id', 'name', 'type', 'enabled', 'handling_fees'],
        },
      ],
    },
    {
      name: 'customs-information',
      describe: 'Customs information on products',
      path: 'shipping/products/customs-information',
      style: 'v3-batch',
      idLabel: 'customs record',
      ops: ['list', 'update', 'delete'],
      deleteQuery: 'product_id:in',
      fields: ['product_id', 'country_of_origin', 'commodity_description', 'hs_codes'],
      params: ['product_id:in'],
    },
  ],
};

export const GEOGRAPHY: ResourceSpec = {
  name: 'geography',
  describe: 'Countries and states reference data',
  children: [
    {
      name: 'countries',
      describe: 'Countries',
      path: 'countries',
      style: 'v2-item',
      ops: ['list', 'get'],
      idLabel: 'country',
      fields: ['id', 'country', 'country_iso2', 'country_iso3'],
      params: ['country', 'country_iso2', 'country_iso3'],
      actions: [
        {
          name: 'count',
          describe: 'Count countries',
          method: 'GET',
          path: 'v2/countries/count',
          envelope: false,
        },
      ],
      children: [
        {
          name: 'states',
          describe: 'States in one country',
          path: 'countries/{country_id}/states',
          style: 'v2-item',
          ops: ['list', 'get'],
          idLabel: 'state',
          fields: ['id', 'state', 'state_abbreviation', 'country_id'],
          actions: [
            {
              name: 'count',
              describe: 'Count this country’s states',
              method: 'GET',
              path: 'v2/countries/{country_id}/states/count',
              envelope: false,
            },
          ],
        },
      ],
    },
    {
      name: 'states',
      describe: 'States across every country',
      path: 'countries/states',
      style: 'v2-item',
      ops: ['list'],
      fields: ['id', 'state', 'state_abbreviation', 'country_id'],
      params: ['state', 'state_abbreviation', 'country_id'],
      actions: [
        {
          name: 'count',
          describe: 'Count states',
          method: 'GET',
          path: 'v2/countries/states/count',
          envelope: false,
        },
      ],
    },
  ],
};

export const WEBHOOKS: ResourceSpec = {
  name: 'webhooks',
  describe: 'Webhook subscriptions',
  path: 'hooks',
  style: 'v3-item',
  idLabel: 'webhook',
  fields: ['id', 'scope', 'destination', 'is_active', 'created_at', 'updated_at'],
  params: ['scope', 'destination', 'is_active'],
  actions: [
    {
      name: 'events',
      describe: 'List webhook events awaiting delivery',
      method: 'GET',
      path: 'v3/hooks/events',
      params: ['scope', 'created_at:min', 'created_at:max'],
    },
  ],
  children: [
    {
      name: 'admin',
      describe: 'Store-wide webhook admin settings',
      path: 'hooks/admin',
      style: 'v3-singleton',
    },
  ],
};
