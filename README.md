# bigc

[![CI](https://github.com/bigcommerce/bigcommerce-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/bigcommerce/bigcommerce-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@bigcommerce/cli.svg)](https://www.npmjs.com/package/@bigcommerce/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

A command-line interface for BigCommerce's REST Management APIs. It covers the
whole public surface — 805 commands across the REST Management API — plus the
Admin GraphQL API and a raw passthrough for anything BigCommerce ships next.

> This is a community-supported tool, released under the MIT licence and
> provided as-is. It is not covered by a BigCommerce support agreement. Issues
> and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

Requires Node 22 or newer.

## Install

```bash
npm install -g @bigcommerce/cli
```

Or from a clone, for development:

```bash
npm install
npm run build
npm link                   # exposes the `bigc` command on your PATH
npm run dev -- <command>   # run without building
```

## Authentication

Get a store hash and access token from the BigCommerce control panel:
**Advanced Settings → API Accounts**. Grant the new API account only the scopes
you actually need — this CLI reaches every endpoint your token is allowed to
reach, including destructive ones.

Credentials are stored at `~/.bc-cli/credentials.json`, organized into named
profiles. The file is written `0600` inside a `0700` directory. Set
`BIGC_CONFIG_DIR` to keep them somewhere else.

```bash
bigc auth login                       # save the "default" profile, prompting
bigc auth login --profile staging     # save a named profile
bigc auth list                        # show saved profiles
bigc auth use staging                 # switch the active profile
bigc auth logout --profile staging    # remove a profile
```

The token prompt doesn't echo what you type.

Any command accepts `--profile <name>` to override the active profile for a
single invocation.

### Credentials in CI

Set both environment variables and skip `auth login` entirely — nothing touches
the filesystem:

```bash
export BIGC_STORE_HASH=abc123
export BIGC_TOKEN=...
bigc catalog products list
```

They apply whenever a command runs without an explicit `--profile <name>`, which
always reads from disk.

Prefer this over passing `--token` on the command line: an argument lands in your
shell history and is visible to other local users in `ps` for the life of the
process.

## The command model

Commands nest the way the API does — `bigc <group> <resource> <operation>` —
and every resource speaks the same five verbs where the endpoint supports them:

```bash
bigc catalog products list                       # GET    a collection
bigc catalog products get 329                    # GET    one record
bigc catalog products create --data '<json>'     # POST
bigc catalog products update 329 --data '<json>' # PUT
bigc catalog products delete 329                 # DELETE
```

Resources nested under a parent take the parent as an option:

```bash
bigc catalog products custom-fields list --product-id 329
bigc pricelists records list --price-list-id 3
bigc sites routes list --site-id 1008
```

Endpoints that aren't CRUD appear as named actions on the resource they belong
to, and singletons — one object per store — drop the ID:

```bash
bigc orders capture --order-id 145         # POST /v3/orders/145/payment_actions/capture
bigc themes activate --data '<json>'       # POST /v3/themes/actions/activate
bigc settings robotstxt get                # GET  /v3/settings/storefront/robotstxt
bigc settings robotstxt update --data '<json>'
```

Collection-level DELETEs are separate and guarded, because bare they wipe the
resource:

```bash
bigc catalog products delete-many --query 'id:in=1,2,3'
bigc catalog products delete-many --yes      # required to delete everything
```

Run `bigc <group> --help` at any level to see what's underneath it.

## What's covered

| Group | Contents |
|---|---|
| `catalog` | products, images, videos, custom fields, bulk pricing rules, complex rules, reviews, modifiers, options, variants, categories, trees, brands, metafields, channel/category assignments, summary |
| `orders` | orders, products, coupons, taxes, messages, shipping addresses, shipments, consignments, transactions, refunds, pickups, statuses, capture/void, settings, metafields |
| `customers` | customers, addresses, attributes, attribute values, form field values, consent, stored instruments, groups, settings, metafields, credential validation, legacy V2 |
| `channels` | channels, listings, site, checkout URL, menus, currency assignments, active theme, metafields |
| `sites` | sites, routes, certificates |
| `inventory` | items, locations, location items, absolute/relative adjustments, metafields |
| `pricelists` | price lists, records (per-currency), assignments |
| `promotions` | promotions, coupon codes, code generation, archive/unarchive, settings |
| `carts` / `checkouts` | carts, items, redirect URLs, checkouts, billing address, consignments, coupons, discounts, order creation, embedded-checkout tokens, settings |
| `payments` | accepted methods, access tokens, stored instruments, `process` |
| `storefront` | GraphQL API tokens, impersonation tokens, redirects (+ import/export), custom template associations |
| `content` | pages, blog posts and tags, scripts, widgets, widget templates, placements, regions |
| `themes` | themes, upload, activate, download, jobs, configurations, custom templates |
| `marketing` | coupons, gift certificates, banners, email templates, abandoned cart emails |
| `settings` | catalog, inventory, logo, favicon, locale, profile, units, storefront category/product/search/security/SEO/status, robots.txt, analytics, filters |
| `tax` | zones, rates, classes, settings, properties, product properties, provider connections |
| `shipping` | zones, methods, carrier connections, customs information |
| `webhooks` | subscriptions, pending events, admin settings |
| `segments` / `shopper-profiles` | customer segmentation both ways |
| `subscribers`, `wishlists`, `currencies`, `geography`, `store`, `abandoned-carts`, `pickup` | the rest |

## Escape hatches

Anything not wrapped — a new endpoint, an undocumented parameter — is still one
command away:

```bash
bigc api GET /v3/sites --query 'limit=50'
bigc api PUT /v3/channels/1000001 --data '{"status":"active"}'
bigc api POST /v3/catalog/categories --file category.json
```

And the Admin GraphQL API:

```bash
bigc graphql --query '{ store { account { id } } }'
bigc graphql --file query.graphql --variables '{"id":329}'
```

## Global flags

| Flag | Description |
|------|-------------|
| `--output json\|table\|pretty` | Output format (default: `pretty`) |
| `--profile <name>` | Override the active credential profile |
| `--all` | Auto-paginate through every page |
| `--query <k=v>` | Any query parameter, repeatable — works on every `list` |
| `--data <json>` / `--file <path>` | Request body, inline or from a file |

Common filters also have named options, so these are equivalent:

```bash
bigc catalog products list --sku EXAMPLE-SKU
bigc catalog products list --query 'sku=EXAMPLE-SKU'
```

## Things worth knowing

- **Image uploads** are multipart and take `--file` (or `--url` where the API
  accepts a remote URL): `catalog products images add`, `catalog categories
  image set`, `catalog brands image set`, `catalog variants image`, `catalog
  products modifiers values image`, `settings images logo|favicon`, and
  `themes upload`.
- **`payments process`** is the one endpoint off the REST host. It posts to
  `payments.bigcommerce.com` and authenticates with a Payment Access Token, so
  it takes `--token` from `bigc payments access-token` rather than your store
  credentials.
- **Channels can't be deleted** — `bigc channels update <id> --data
  '{"status":"inactive"}'` is how a storefront is retired.
- **Digital product files can't be managed over the API at all** — control panel
  or WebDAV only. There's no command because there's no endpoint.
- **`catalog categories create|update|delete`** go through
  `/v3/catalog/trees/categories`, the batch endpoints. The single-category
  `/v3/catalog/categories/{id}` routes are reachable via `bigc api`.
- Both API versions are in play: V3 where it exists, V2 for orders, coupons,
  gift certificates, banners, customer groups, currencies, shipping zones,
  geography, and store info.

## How it works

- **Base URL**: `https://api.bigcommerce.com/stores/{store_hash}/{version}`
- **Auth**: `X-Auth-Token` header
- **Rate limits**: 429 responses are retried automatically using the
  `X-Rate-Limit-Time-Reset-Ms` header
- **Pagination**: `--all` follows V3's `meta.pagination` and V2's empty-array
  terminator

Most of the surface is declared rather than written out. `src/resources/`
describes each endpoint — its path, style, table columns, and filters — and
`src/resource.ts` turns those declarations into commander commands. A resource
whose name already belongs to a hand-written command keeps that implementation
and is only extended with the operations and children it lacks, which is how the
multipart upload commands survive alongside the generated ones.

Adding a new endpoint is usually a few lines in `src/resources/`.

## Project layout

```
src/
├── commands/       hand-written commands: auth, api, graphql, and the
│                   multipart uploads under catalog/orders/customers/
│                   channels/inventory
├── resources/      declarative specs for the rest of the API surface
├── resource.ts     turns a spec into commander commands
├── api/
│   ├── client.ts   HTTP client: auth, rate limits, pagination, multipart
│   └── factory.ts  builds a client from a credential profile
├── config.ts       credential file read/write
├── output.ts       json/table/pretty formatters
└── index.ts        entry point

test/               mirrors src/; no test makes a network call
```

## Development

```bash
npm install
npm test             # run the suite
npm run test:watch   # watch mode
npm run lint         # ESLint, using @bigcommerce/eslint-config
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
```

The test suite stubs the HTTP layer end to end, so it needs no credentials and
makes no network calls. Coverage is enforced at 70%; CI fails below it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add an endpoint, what counts
as a breaking change, and the release process.

## References

- [BigCommerce developer docs](https://developer.bigcommerce.com/docs/start/about-our-apis)
- [Authentication](https://developer.bigcommerce.com/docs/start/authentication)
- [REST Management API](https://developer.bigcommerce.com/docs/rest-management)
- [REST Catalog API](https://developer.bigcommerce.com/docs/rest-catalog)
- [OpenAPI specs](https://github.com/bigcommerce/api-specs)
- [Rate limits](https://developer.bigcommerce.com/docs/start/best-practices/api-rate-limits)

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Please don't open a
public issue for a security problem.

## Contributing

Bug reports, documentation fixes, and new endpoint coverage are all welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Release history lives in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT License

Copyright (c) 2026 BigCommerce, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
