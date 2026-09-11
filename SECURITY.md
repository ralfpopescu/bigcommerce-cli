# Security Policy

## Supported versions

Security fixes are applied to the latest released minor version. Older versions
are not backported.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/bigcommerce/bigcommerce-cli/security/advisories/new),
or by email to security@bigcommerce.com.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The version of `bigc` and of Node.js you're running

Redact any store hashes, access tokens, or customer data from your report.

## What to expect

- We acknowledge reports within **two business days**.
- We resolve Critical and High severity issues within **30 days**, and Medium
  and below within **60 days**.
- We'll credit you in the release notes when the fix ships, unless you'd rather
  we didn't.

## A note on credentials

`bigc` stores access tokens in plain text at `~/.bc-cli/credentials.json`
(overridable with `BIGC_CONFIG_DIR`), written `0600` inside a `0700` directory.
This is the same model as most CLI tools, and it means anyone who can read your
home directory can read your tokens.

Two consequences worth knowing:

- Prefer `BIGC_STORE_HASH` / `BIGC_TOKEN` in CI, so no token touches the disk.
- Avoid passing `--token` on the command line. Arguments land in shell history
  and are visible to other local users via `ps` for the life of the process.

Grant API accounts only the scopes they need. `bigc` can reach every endpoint a
token is authorized for, including destructive ones.
