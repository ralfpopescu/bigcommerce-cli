import { ResourceSpec } from '../resource';
import { metafields } from './metafields';

const PRODUCT_FIELDS = ['id', 'name', 'sku', 'type', 'price', 'availability', 'inventory_level', 'is_visible'];
const CATEGORY_FIELDS = ['id', 'name', 'parent_id', 'tree_id', 'sort_order', 'is_visible'];
const BRAND_FIELDS = ['id', 'name', 'page_title'];
const VARIANT_FIELDS = ['id', 'product_id', 'sku', 'price', 'cost_price', 'weight', 'inventory_level'];
const IMAGE_FIELDS = ['id', 'product_id', 'is_thumbnail', 'sort_order', 'description', 'url_thumbnail'];

const PRODUCT = 'catalog/products/{product_id}';

export const CATALOG: ResourceSpec = {
  name: 'catalog',
  describe: 'Manage the product catalog',
  children: [
    {
      name: 'products',
      describe: 'Products',
      path: 'catalog/products',
      style: 'v3-item',
      idLabel: 'product',
      fields: PRODUCT_FIELDS,
      params: ['name', 'sku', 'type', 'keyword', 'brand_id', 'categories', 'availability', 'is_visible', 'include', 'include_fields', 'sort', 'direction'],
      ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
      actions: [
        {
          name: 'update-many',
          describe: 'Update products in bulk',
          method: 'PUT',
          path: 'v3/catalog/products',
          body: true,
          done: 'Products updated',
        },
      ],
      children: [
        // Only `get` is added here — list/add/update/delete are hand-written so
        // they can stream multipart uploads.
        {
          name: 'images',
          describe: 'Product images',
          path: `${PRODUCT}/images`,
          style: 'v3-item',
          ops: ['get'],
          idLabel: 'image',
          fields: IMAGE_FIELDS,
        },
        {
          name: 'videos',
          describe: 'Product videos',
          path: `${PRODUCT}/videos`,
          style: 'v3-item',
          idLabel: 'video',
          fields: ['id', 'title', 'type', 'video_id', 'sort_order', 'length'],
        },
        {
          name: 'custom-fields',
          describe: 'Product custom fields',
          path: `${PRODUCT}/custom-fields`,
          style: 'v3-item',
          idLabel: 'custom field',
          fields: ['id', 'name', 'value'],
        },
        {
          name: 'bulk-pricing-rules',
          describe: 'Product bulk pricing rules',
          path: `${PRODUCT}/bulk-pricing-rules`,
          style: 'v3-item',
          idLabel: 'bulk pricing rule',
          fields: ['id', 'quantity_min', 'quantity_max', 'type', 'amount'],
        },
        {
          name: 'complex-rules',
          describe: 'Product complex rules',
          path: `${PRODUCT}/complex-rules`,
          style: 'v3-item',
          idLabel: 'complex rule',
          fields: ['id', 'enabled', 'stop', 'price_adjuster', 'sort_order'],
        },
        {
          name: 'reviews',
          describe: 'Product reviews',
          path: `${PRODUCT}/reviews`,
          style: 'v3-item',
          idLabel: 'review',
          fields: ['id', 'title', 'rating', 'status', 'email', 'name', 'date_created'],
          params: ['status', 'rating', 'email'],
        },
        {
          name: 'modifiers',
          describe: 'Product modifiers',
          path: `${PRODUCT}/modifiers`,
          style: 'v3-item',
          idLabel: 'modifier',
          fields: ['id', 'display_name', 'type', 'required', 'sort_order'],
          children: [
            {
              name: 'values',
              describe: 'Modifier values',
              path: `${PRODUCT}/modifiers/{modifier_id}/values`,
              style: 'v3-item',
              idLabel: 'modifier value',
              fields: ['id', 'label', 'sort_order', 'is_default'],
              actions: [
                {
                  name: 'image',
                  describe: 'Upload the image shown when this value is selected',
                  method: 'POST',
                  path: `v3/${PRODUCT}/modifiers/{modifier_id}/values/{value_id}/image`,
                  upload: { field: 'image_file' },
                  done: 'Modifier value image uploaded',
                },
              ],
            },
          ],
        },
        {
          name: 'options',
          describe: 'Product variant options',
          path: `${PRODUCT}/options`,
          style: 'v3-item',
          idLabel: 'option',
          fields: ['id', 'display_name', 'type', 'sort_order'],
          children: [
            {
              name: 'values',
              describe: 'Option values',
              path: `${PRODUCT}/options/{option_id}/values`,
              style: 'v3-item',
              idLabel: 'option value',
              fields: ['id', 'label', 'sort_order', 'is_default'],
            },
          ],
        },
        metafields(PRODUCT),
      ],
    },

    {
      name: 'categories',
      describe: 'Categories',
      path: 'catalog/categories',
      style: 'v3-item',
      idLabel: 'category',
      fields: CATEGORY_FIELDS,
      params: ['name', 'parent_id', 'keyword', 'is_visible', 'page_title'],
      ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
      actions: [
        {
          name: 'sort-order',
          describe: 'Get the manual product sort order for a category',
          method: 'GET',
          path: 'v3/catalog/categories/{category_id}/products/sort-order',
          fields: ['product_id', 'sort_order'],
        },
        {
          name: 'set-sort-order',
          describe: 'Set the manual product sort order for a category',
          method: 'PUT',
          path: 'v3/catalog/categories/{category_id}/products/sort-order',
          body: true,
          done: 'Sort order updated',
        },
      ],
      children: [metafields('catalog/categories/{category_id}')],
    },

    {
      name: 'trees',
      describe: 'Category trees',
      path: 'catalog/trees',
      style: 'v3-batch',
      idLabel: 'tree',
      ops: ['list', 'update', 'delete'],
      fields: ['id', 'name', 'channels'],
      children: [
        {
          name: 'categories',
          describe: 'Categories addressed across trees',
          path: 'catalog/trees/categories',
          style: 'v3-batch',
          idLabel: 'category',
          deleteQuery: 'category_id:in',
          fields: CATEGORY_FIELDS,
          params: ['category_id:in', 'tree_id:in', 'parent_id:in', 'name', 'is_visible'],
        },
        {
          name: 'in-tree',
          describe: 'Categories belonging to one tree',
          path: 'catalog/trees/{tree_id}/categories',
          style: 'v3-item',
          ops: ['list'],
          fields: CATEGORY_FIELDS,
        },
      ],
    },

    {
      name: 'brands',
      describe: 'Brands',
      path: 'catalog/brands',
      style: 'v3-item',
      idLabel: 'brand',
      fields: BRAND_FIELDS,
      params: ['name', 'page_title', 'keyword'],
      ops: ['list', 'get', 'create', 'update', 'delete', 'delete-many'],
      children: [metafields('catalog/brands/{brand_id}')],
    },

    {
      name: 'variants',
      describe: 'Product variants',
      path: `${PRODUCT}/variants`,
      style: 'v3-item',
      idLabel: 'variant',
      fields: VARIANT_FIELDS,
      actions: [
        {
          name: 'image',
          describe: 'Set the image shown when this variant is selected',
          method: 'POST',
          path: `v3/${PRODUCT}/variants/{variant_id}/image`,
          upload: { field: 'image_file', urlField: 'image_url' },
          done: 'Variant image set',
        },
      ],
      children: [metafields(`${PRODUCT}/variants/{variant_id}`)],
    },

    {
      name: 'all-variants',
      describe: 'Variants across every product',
      path: 'catalog/variants',
      style: 'v3-item',
      ops: ['list'],
      fields: VARIANT_FIELDS,
      params: ['sku', 'product_id', 'include_fields'],
      actions: [
        {
          name: 'update-many',
          describe: 'Update variants in bulk across products',
          method: 'PUT',
          path: 'v3/catalog/variants',
          body: true,
          done: 'Variants updated',
        },
      ],
    },

    {
      name: 'channel-assignments',
      describe: 'Product-to-channel assignments',
      path: 'catalog/products/channel-assignments',
      style: 'v3-batch',
      idLabel: 'assignment',
      ops: ['list', 'update', 'delete'],
      deleteQuery: 'product_id:in',
      fields: ['product_id', 'channel_id'],
      params: ['product_id:in', 'channel_id:in'],
    },

    {
      name: 'category-assignments',
      describe: 'Product-to-category assignments',
      path: 'catalog/products/category-assignments',
      style: 'v3-batch',
      idLabel: 'assignment',
      ops: ['list', 'update', 'delete'],
      deleteQuery: 'product_id:in',
      fields: ['product_id', 'category_id'],
      params: ['product_id:in', 'category_id:in'],
    },

    {
      name: 'summary',
      describe: 'Catalog totals and date ranges',
      path: 'catalog/summary',
      style: 'v3-singleton',
      ops: ['get'],
    },
  ],
};
