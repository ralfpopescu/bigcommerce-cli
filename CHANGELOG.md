# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For what counts as a breaking change in a CLI, see
[CONTRIBUTING.md](CONTRIBUTING.md#what-semver-means-here).

## [Unreleased]

### Added

- Test suite (Vitest) covering the HTTP client, credential handling, output
  formatters, and resource-spec expansion, with a 70% coverage floor enforced in CI.
- Continuous integration on pull requests: type-check, lint, test, build, and a
  CLI smoke test across Node 18, 20, and 22.
- ESLint and Prettier, using the shared `@bigcommerce/eslint-config`.
- `BIGC_CONFIG_DIR` environment variable to override the credential directory.
- Contribution, security, code of conduct, and support documentation.

### Changed

- `ApiClient` now takes an options object, accepting an injectable `fetch`
  implementation and base URL.
- Output formatters return strings instead of writing directly to stdout, and
  the process exit code is set at the entry point rather than deep in the call tree.

## [0.2.0] - 2026-09-10

Baseline release. This is the first version tracked in a changelog; earlier
development predates it and is not itemized here.

### Added

- REST Management API coverage across catalog, orders, customers, channels,
  inventory, pricelists, promotions, carts, checkouts, payments, storefront,
  content, themes, marketing, settings, tax, shipping, and webhooks.
- Admin GraphQL support via `bigc graphql`, and a raw passthrough via `bigc api`.
- Credential profiles stored at `~/.bc-cli/credentials.json`, with
  `BIGC_STORE_HASH` / `BIGC_TOKEN` environment variable support for CI.
- Multipart upload commands for product, category, brand, and variant images,
  store logo and favicon, and theme uploads.
- `bigc payments process` against the payment host, authenticating with a
  Payment Access Token.
- Binary download support for theme downloads and redirect exports.
- `json`, `table`, and `pretty` output formats.
- Automatic retry on rate limiting, and `--all` auto-pagination for both API versions.
- Guarded collection-level deletes (`delete-many`), which require either a
  filter or an explicit `--yes`.

[Unreleased]: https://github.com/bigcommerce/bigcommerce-cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/bigcommerce/bigcommerce-cli/releases/tag/v0.2.0
