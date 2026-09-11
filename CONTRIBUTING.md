# Contributing

Thanks for your interest in improving `bigc`. Bug reports, documentation fixes,
and new endpoint coverage are all welcome.

## Getting set up

Requires Node 18 or newer.

```bash
git clone https://github.com/bigcommerce/bigcommerce-cli.git
cd bigcommerce-cli
npm install
npm run build
npm link                    # exposes `bigc` on your PATH
```

Run the CLI without building:

```bash
npm run dev -- catalog products list
```

| Command | What it does |
|---|---|
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests and report coverage |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Apply Prettier |
| `npm run build` | Compile to `dist/` |

### Testing against a real store

The test suite never makes network calls, so you don't need credentials to run
it. If you want to exercise a change by hand, create a dedicated API account on
a development store — never a production one — and grant it only the scopes the
change touches.

Use a named profile so you can't reach the wrong store by accident:

```bash
bigc auth login --profile scratch
bigc --profile scratch catalog products list
```

Or set `BIGC_CONFIG_DIR` to keep test credentials out of your real config:

```bash
export BIGC_CONFIG_DIR=/tmp/bigc-scratch
```

## Adding an endpoint

Most of the API surface is declared, not written out. `src/resources/` holds a
spec per resource — path, style, table columns, filters — and `src/resource.ts`
expands those specs into commander commands. Adding an endpoint is usually a few
lines in the right `src/resources/*.ts` file:

```ts
{
  name: 'widgets',
  describe: 'Storefront widgets',
  path: 'content/widgets',
  style: 'v3-item',
  fields: ['uuid', 'name', 'widget_template_uuid'],
  params: ['widget_template_uuid'],
}
```

Reach for a hand-written command in `src/commands/` only when the generic
builders genuinely can't express the behaviour — multipart uploads, prompting,
or a non-standard host. Hand-written commands are registered first and are then
extended by `mountAll` with whatever operations they don't already define.

## Pull requests

Before opening a PR:

- `npm run lint && npm run typecheck && npm test` all pass.
- New code has tests. Coverage must stay at or above **70%**; CI fails below it.
- The changelog has an entry under `## [Unreleased]`.
- Commits are scoped to one logical change.

Every PR needs a green CI run and approval from one maintainer before it can be
merged. We aim to respond to pull requests and issues within **two business days**.
A response isn't always a merge — if we can't take a change, we'll explain why,
and we appreciate the effort either way.

### Do not include internal or private information

This is a public repository. Code, comments, commit messages, pull requests, and
issues must not contain:

- Internal company discussions, tickets, or documents
- Screenshots of internal tools or dashboards
- Private or unreleased library code
- Store hashes, access tokens, API keys, or customer data

Sanitize anything you paste from a real store. Store hashes and tokens are
credentials — treat a leaked one as compromised and rotate it in the control
panel immediately.

## What semver means here

The public contract of a CLI is broader than an exported API. For this project,
all of the following are part of it:

- Command and subcommand names
- Flag names and their accepted values
- The shape of `--output json` — key names, nesting, and types
- Exit codes

| Change | Release |
|---|---|
| Bug fix, no interface change | patch |
| New command, flag, or endpoint | minor |
| Renaming or removing a command or flag; changing a JSON key or exit code | major |

Changing a key in `--output json` breaks every script piping us into `jq`. It's
a major bump, not a patch.

## Releasing

Maintainers only:

1. Move the `## [Unreleased]` entries into a new version section in `CHANGELOG.md`, dated.
2. `npm version <patch|minor|major>` — this commits and tags with a `v` prefix.
3. Push the commit and the tag: `git push && git push --tags`.
4. The release workflow builds, tests, publishes to npm, and opens a GitHub
   Release from the changelog section.

## Code of Conduct

This project is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you're expected to uphold it.
