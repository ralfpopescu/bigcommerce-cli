---
name: bigc
description: Use the bigc CLI to interact with BigCommerce APIs. Invoke when the user wants to query or manage a BigCommerce store — products, categories, brands, variants, orders, customers, channels, or inventory.
argument-hint: "[command] [subcommand] [args]"
allowed-tools: "Bash"
---

You are helping the user interact with their BigCommerce store via `bigc`, a CLI built on the BigCommerce REST API.

The user's request is: $ARGUMENTS

Use the `Bash` tool to run `bigc` commands on their behalf. Always show the command you're running before executing it. If the result is large, summarize the key fields rather than dumping everything.

---

## Auth

Before any API command works, credentials must be configured. Credentials live in `~/.bc-cli/credentials.json`.

```bash
bigc auth login                        # prompts for store hash + access token
bigc auth login --profile staging      # named profile
bigc auth logout                       # removes default profile
bigc auth logout --profile staging
bigc auth list                         # show all saved profiles
bigc auth use <profile>                # switch active profile
```

To get credentials: BigCommerce Control Panel → Advanced Settings → API Accounts → Create API Account. Required scopes depend on the resources being accessed.

---

## Global flags

Every command supports these flags:

| Flag | Values | Default | Notes |
|------|--------|---------|-------|
| `--output` | `json`, `table`, `pretty` | `pretty` | Use `json` to pipe to `jq` |
| `--profile` | profile name | active profile | Override credentials inline |

---

## Catalog — Products

```bash
bigc catalog products list
bigc catalog products list --page 2 --limit 25
bigc catalog products list --all                      # auto-paginate all pages
bigc catalog products list --all --output json        # pipe-friendly full export

bigc catalog products get <id>
bigc catalog products get <id> --output json

bigc catalog products create --data '{"name":"Widget","type":"physical","price":9.99,"weight":1}'
bigc catalog products create --file ./new-product.json

# Create with images attached in one shot — both flags are repeatable
bigc catalog products create --file ./product.json \
  --image-file ./photos/main.jpg --image-file ./photos/alt.jpg \
  --image-url https://cdn.example.com/hero.png

bigc catalog products update <id> --data '{"price":14.99}'
bigc catalog products update <id> --file ./updates.json
bigc catalog products update <id> --image-file ./new-photo.jpg     # images-only update is allowed

bigc catalog products delete <id>
```

**Table columns (pretty/table mode):** `id`, `name`, `sku`, `type`, `price`, `availability`, `inventory_level`, `is_visible`

### Product images

Local files use multipart upload; URLs use JSON. Max ~8 MB per image; JPEG/PNG/GIF/WebP.

```bash
bigc catalog products images list --product-id <id>
bigc catalog products images list --product-id <id> --all

bigc catalog products images add --product-id <id> --file ./photo.jpg
bigc catalog products images add --product-id <id> --url https://cdn.example.com/photo.jpg \
  --description "Front view" --is-thumbnail --sort-order 0

bigc catalog products images update --product-id <id> <image-id> --file ./replacement.jpg
bigc catalog products images update --product-id <id> <image-id> --description "Updated alt"

bigc catalog products images delete --product-id <id> <image-id>
```

---

## Catalog — Categories

```bash
bigc catalog categories list
bigc catalog categories list --all
bigc catalog categories get <id>

# Create — requires name, tree_id (default tree is usually 1), parent_id (0 = root).
# CLI wraps the single object into an array for the V3 trees endpoint.
bigc catalog categories create --data '{"name":"Single Cards","tree_id":1,"parent_id":0}'
bigc catalog categories create --file ./categories.json   # file may be array for bulk

bigc catalog categories update <id> --data '{"name":"Renamed","sort_order":5}'
bigc catalog categories delete <id>

# Single category image (one per category)
bigc catalog categories image set --category-id <id> --file ./category.jpg
bigc catalog categories image set --category-id <id> --url https://cdn.example.com/cat.jpg
bigc catalog categories image delete --category-id <id>
```

**Table columns:** `id`, `name`, `parent_id`, `sort_order`, `is_visible`

---

## Catalog — Brands

```bash
bigc catalog brands list
bigc catalog brands list --all
bigc catalog brands get <id>

# Single brand image (one per brand)
bigc catalog brands image set --brand-id <id> --file ./brand.jpg
bigc catalog brands image set --brand-id <id> --url https://cdn.example.com/brand.jpg
bigc catalog brands image delete --brand-id <id>
```

**Table columns:** `id`, `name`, `page_title`

---

## Catalog — Variants

```bash
bigc catalog variants list --product-id <id>
bigc catalog variants list --product-id <id> --all
bigc catalog variants get --product-id <id> <variant-id>

# Create a variant on a product. BigCommerce requires option_values to map to existing
# product options/option-values; create those on the product first if needed.
bigc catalog variants create --product-id <id> \
  --data '{"sku":"ACC-RARE","price":12.99,"inventory_level":10,"image_url":"https://cdn.example.com/rare.png","option_values":[{"option_display_name":"Rarity","label":"Rare"}]}'
bigc catalog variants create --product-id <id> --file ./variant.json

bigc catalog variants update --product-id <id> <variant-id> --data '{"price":14.99,"inventory_level":5}'
bigc catalog variants delete --product-id <id> <variant-id>
```

**Table columns:** `id`, `sku`, `price`, `cost_price`, `weight`, `inventory_level`, `purchasing_disabled`

---

## Orders

Orders use the BigCommerce V2 API. `status` is a numeric status ID.

```bash
bigc orders list
bigc orders list --status 11                          # 11 = Awaiting Fulfillment
bigc orders list --page 1 --limit 50
bigc orders list --all                                # all pages

bigc orders get <id>

bigc orders update <id> --status 2                    # 2 = Shipped
```

Common V2 status IDs: `0` Incomplete, `1` Pending, `2` Shipped, `7` Cancelled, `10` Completed, `11` Awaiting Fulfillment

**Table columns:** `id`, `status`, `customer_id`, `date_created`, `total_inc_tax`, `currency_code`, `payment_method`, `items_total`

---

## Customers

The V3 Customers API accepts and returns arrays. The CLI handles wrapping single items automatically.

```bash
bigc customers list
bigc customers list --page 1 --limit 50
bigc customers list --all

bigc customers get <id>

bigc customers create --data '{"first_name":"Jane","last_name":"Doe","email":"jane@example.com","authentication":{"new_password":"s3cur3"}}'
bigc customers create --file ./customers.json          # can be array or single object

bigc customers update <id> --data '{"phone":"555-1234"}'
bigc customers update <id> --file ./updates.json

bigc customers delete <id>
```

**Table columns:** `id`, `first_name`, `last_name`, `email`, `company`, `phone`, `customer_group_id`, `date_created`

---

## Channels

```bash
bigc channels list
bigc channels list --all
bigc channels get <id>
```

**Table columns:** `id`, `type`, `platform`, `name`, `is_enabled`, `is_listable_from_ui`, `is_visible`, `status`, `date_created`

---

## Inventory

The inventory API tracks stock per product/variant per location.

```bash
bigc inventory list
bigc inventory list --location-id <id>
bigc inventory list --product-id <id>
bigc inventory list --all

bigc inventory update --location-id <id> --product-id <id> --quantity <n>
bigc inventory update --location-id <id> --product-id <id> --variant-id <id> --quantity <n>
```

**Table columns:** `product_id`, `variant_id`, `sku`, `location_id`, `available_to_sell`, `total_inventory_onhand`, `safety_stock`, `is_in_stock`

---

## Common patterns

**Export all products to JSON:**
```bash
bigc catalog products list --all --output json > products.json
```

**Pipe to jq:**
```bash
bigc orders list --all --output json | jq '[.[] | {id, status, total: .total_inc_tax}]'
bigc catalog products list --all --output json | jq '.[] | select(.inventory_level < 5) | .name'
```

**Use a non-default profile:**
```bash
bigc catalog products list --profile staging
bigc orders list --profile production --output json
```

**Bulk create from file:**
```bash
bigc customers create --file customers.json   # file can be [] array of customer objects
```

---

## Error handling

- `Profile "X" not found` → run `bigc auth login` or `bigc auth login --profile X`
- `401` / `403` → access token is invalid or missing required OAuth scopes
- `404` → resource ID does not exist on the store
- `429` → rate limit hit; the CLI retries automatically using the `X-Rate-Limit-Time-Reset-Ms` header

---

## Source

CLI source is in `/Users/ralf.popescu/Repos/bc-cli`. Build with `npm run build` after changes.
BigCommerce API docs: https://developer.bigcommerce.com/docs/rest-management
