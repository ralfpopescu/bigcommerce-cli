import { ResourceSpec } from '../resource';
import { CATALOG } from './catalog';
import { CUSTOMERS, SUBSCRIBERS, SEGMENTS, SHOPPER_PROFILES, WISHLISTS } from './customers';
import { ORDERS, PICKUP } from './orders';
import { CARTS, CHECKOUTS, PAYMENTS, PRICELISTS, PROMOTIONS, ABANDONED_CARTS } from './commerce';
import { CHANNELS, SITES, INVENTORY } from './channels';
import { CONTENT, THEMES, MARKETING, STOREFRONT } from './content';
import { SETTINGS, STORE, CURRENCIES, TAX, SHIPPING, GEOGRAPHY, WEBHOOKS } from './store';

/**
 * The full REST Management surface, declared rather than written out. Anything
 * already registered by a hand-written command keeps its own implementation —
 * see `mount` in ../resource.ts.
 */
export const RESOURCES: ResourceSpec[] = [
  CATALOG,
  ORDERS,
  PICKUP,
  CUSTOMERS,
  SUBSCRIBERS,
  SEGMENTS,
  SHOPPER_PROFILES,
  WISHLISTS,
  CHANNELS,
  SITES,
  INVENTORY,
  CARTS,
  CHECKOUTS,
  PAYMENTS,
  PRICELISTS,
  PROMOTIONS,
  ABANDONED_CARTS,
  CONTENT,
  THEMES,
  MARKETING,
  STOREFRONT,
  SETTINGS,
  STORE,
  CURRENCIES,
  TAX,
  SHIPPING,
  GEOGRAPHY,
  WEBHOOKS,
];

/** The declared query filters for a resource path, e.g. paramsFor('catalog', 'products'). */
export function paramsFor(...path: string[]): string[] {
  let nodes: ResourceSpec[] = RESOURCES;
  let found: ResourceSpec | undefined;
  for (const name of path) {
    found = nodes.find(n => n.name === name);
    if (!found) return [];
    nodes = found.children ?? [];
  }
  return found?.params ?? [];
}
