---
name: bigc
description: Use the bigc CLI to read or change a BigCommerce store. Invoke when the user wants to query or manage store data — products, orders, customers, channels, inventory, content, themes, settings, webhooks.
argument-hint: "[what you want to do]"
allowed-tools: "Bash"
---

The user's request is: $ARGUMENTS

If the `bigcommerce` plugin (bc-agent-kit) is installed, follow its
`bigcommerce` skill instead of this command — it has the full workflow and
reference files.

Otherwise:

1. Run `bigc doctor --output json` once to see which store and profile are
   active, whether the session is read-only, and which areas the token can read.
2. Find commands with `bigc commands --json --filter <term>` (for example
   `--filter orders`), or `bigc help <command words> --json`. Don't guess
   command names or flags.
3. Run reads with `--output json` and pipe through `jq` when useful.
4. For anything that writes, run it with `--dry-run` first, show the user the
   method, path and body, and wait for their explicit confirmation before
   running it for real.
5. Use the exit code: 2 fix the command; 3 missing scope or bad credentials
   (tell the user, don't retry); 4 not found; 5 fix the fields named in the
   error and retry (at most 3 times); 6 rate limited; 7 read-only mode — stop;
   8 BigCommerce server error.

Never put an access token on the command line; use `BIGC_STORE_HASH` and
`BIGC_TOKEN` or a saved profile.
