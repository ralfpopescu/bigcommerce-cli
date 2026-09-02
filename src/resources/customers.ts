import { ResourceSpec } from '../resource';
import { metafields, batchMetafields } from './metafields';

const CUSTOMER_FIELDS = ['id', 'first_name', 'last_name', 'email', 'company', 'phone', 'customer_group_id', 'date_created'];
const ADDRESS_FIELDS = ['id', 'customer_id', 'first_name', 'last_name', 'city', 'state_or_province', 'country_code', 'postal_code'];

export const CUSTOMERS: ResourceSpec = {
  name: 'customers',
  describe: 'Manage customers',
  path: 'customers',
  style: 'v3-batch',
  idLabel: 'customer',
  fields: CUSTOMER_FIELDS,
  params: ['email:in', 'name:like', 'company:in', 'customer_group_id:in', 'date_created:min', 'include'],
  actions: [
    {
      name: 'validate-credentials',
      describe: 'Check an email and password against a channel',
      method: 'POST',
      path: 'v3/customers/validate-credentials',
      body: true,
    },
    {
      name: 'count',
      describe: 'Count customers (V2)',
      method: 'GET',
      path: 'v2/customers/count',
      envelope: false,
    },
    {
      name: 'validate-password',
      describe: 'Validate one customer password (V2)',
      method: 'POST',
      path: 'v2/customers/{customer_id}/validate',
      body: true,
      envelope: false,
    },
  ],
  children: [
    {
      name: 'addresses',
      describe: 'Customer addresses',
      path: 'customers/addresses',
      style: 'v3-batch',
      idLabel: 'address',
      fields: ADDRESS_FIELDS,
      params: ['customer_id:in', 'company:in', 'name:in', 'city:in', 'country_code:in'],
    },
    {
      name: 'attributes',
      describe: 'Customer attribute definitions',
      path: 'customers/attributes',
      style: 'v3-batch',
      idLabel: 'attribute',
      fields: ['id', 'name', 'type', 'date_created'],
      params: ['id:in', 'name:in'],
    },
    {
      name: 'attribute-values',
      describe: 'Customer attribute values',
      path: 'customers/attribute-values',
      style: 'v3-batch',
      idLabel: 'attribute value',
      ops: ['list', 'update', 'delete'],
      deleteQuery: 'customer_id:in',
      fields: ['attribute_id', 'customer_id', 'value', 'date_modified'],
      params: ['customer_id:in', 'attribute_id:in'],
    },
    {
      name: 'form-field-values',
      describe: 'Customer form field values',
      path: 'customers/form-field-values',
      style: 'v3-batch',
      idLabel: 'form field value',
      ops: ['list', 'update'],
      fields: ['name', 'value', 'customer_id', 'address_id'],
      params: ['customer_id:in', 'address_id:in', 'field_name'],
    },
    {
      name: 'consent',
      describe: 'One customer’s cookie consent',
      path: 'customers/{customer_id}/consent',
      style: 'v3-singleton',
    },
    {
      name: 'stored-instruments',
      describe: 'One customer’s stored payment instruments',
      path: 'customers/{customer_id}/stored-instruments',
      style: 'v3-item',
      ops: ['list'],
      fields: ['type', 'token', 'last_four', 'brand', 'expiry_month', 'expiry_year', 'is_default'],
    },
    {
      name: 'groups',
      describe: 'Customer groups',
      path: 'customer_groups',
      style: 'v2-item',
      idLabel: 'customer group',
      ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
      fields: ['id', 'name', 'is_default', 'category_access', 'discount_rules'],
      actions: [
        {
          name: 'count',
          describe: 'Count customer groups',
          method: 'GET',
          path: 'v2/customer_groups/count',
          envelope: false,
        },
      ],
    },
    {
      name: 'settings',
      describe: 'Store-wide customer settings',
      path: 'customers/settings',
      style: 'v3-singleton',
      children: [
        {
          name: 'channel',
          describe: 'Per-channel customer settings',
          path: 'customers/settings/channels/{channel_id}',
          style: 'v3-singleton',
        },
      ],
    },
    {
      name: 'v2',
      describe: 'Customers (legacy V2)',
      path: 'customers',
      style: 'v2-item',
      idLabel: 'customer',
      ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
      fields: CUSTOMER_FIELDS,
      params: ['email', 'company', 'customer_group_id', 'min_id', 'max_id', 'min_date_created'],
      children: [
        {
          name: 'addresses',
          describe: 'Addresses on one customer (legacy V2)',
          path: 'customers/{customer_id}/addresses',
          style: 'v2-item',
          idLabel: 'address',
          ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
          fields: ADDRESS_FIELDS,
          actions: [
            {
              name: 'count',
              describe: 'Count this customer’s addresses',
              method: 'GET',
              path: 'v2/customers/{customer_id}/addresses/count',
              envelope: false,
            },
          ],
        },
      ],
    },
    metafields('customers/{customer_id}'),
    batchMetafields('customers/metafields'),
  ],
};

export const SUBSCRIBERS: ResourceSpec = {
  name: 'subscribers',
  describe: 'Newsletter subscribers',
  path: 'customers/subscribers',
  style: 'v3-item',
  idLabel: 'subscriber',
  ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
  fields: ['id', 'email', 'first_name', 'last_name', 'source', 'order_id', 'channel_id', 'date_created'],
  params: ['email', 'first_name', 'last_name', 'source', 'order_id', 'date_created'],
};

export const SEGMENTS: ResourceSpec = {
  name: 'segments',
  describe: 'Customer segments',
  path: 'segments',
  style: 'v3-batch',
  idLabel: 'segment',
  fields: ['id', 'name', 'description', 'date_created', 'date_modified'],
  params: ['id:in'],
  children: [
    {
      name: 'profiles',
      describe: 'Shopper profiles in a segment',
      path: 'segments/{segment_id}/shopper-profiles',
      style: 'v3-batch',
      idLabel: 'shopper profile',
      ops: ['list', 'create', 'delete'],
      fields: ['id', 'customer_id', 'date_created'],
    },
  ],
};

export const SHOPPER_PROFILES: ResourceSpec = {
  name: 'shopper-profiles',
  describe: 'Shopper profiles',
  path: 'shopper-profiles',
  style: 'v3-batch',
  idLabel: 'shopper profile',
  ops: ['list', 'create', 'delete'],
  fields: ['id', 'customer_id', 'date_created', 'date_modified'],
  children: [
    {
      name: 'segments',
      describe: 'Segments a shopper profile belongs to',
      path: 'shopper-profiles/{shopper_profile_id}/segments',
      style: 'v3-item',
      ops: ['list'],
      fields: ['id', 'name', 'description'],
    },
  ],
};

export const WISHLISTS: ResourceSpec = {
  name: 'wishlists',
  describe: 'Customer wishlists',
  path: 'wishlists',
  style: 'v3-item',
  idLabel: 'wishlist',
  fields: ['id', 'customer_id', 'name', 'is_public', 'token'],
  params: ['customer_id'],
  children: [
    {
      name: 'items',
      describe: 'Wishlist items',
      path: 'wishlists/{wishlist_id}/items',
      style: 'v3-item',
      idLabel: 'wishlist item',
      ops: ['create', 'delete'],
      fields: ['id', 'product_id', 'variant_id'],
    },
  ],
};
