import { Command } from 'commander';
import ora from 'ora';

import { createClient } from '../api/factory';
import { errorOut, OutputFormat, print, success } from '../output';
import { queryOption, queryParams } from '../resource';
import { paramsFor } from '../resources';

const INVENTORY_FIELDS = [
  'product_id',
  'variant_id',
  'sku',
  'location_id',
  'available_to_sell',
  'total_inventory_onhand',
  'safety_stock',
  'is_in_stock',
];

function addOpts(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'output format: json|table|pretty', 'pretty')
    .option('--profile <name>', 'credential profile');
}

export function registerInventory(program: Command): void {
  const inventory = program.command('inventory').description('Manage inventory');

  addOpts(
    queryOption(
      inventory
        .command('list')
        .description('List inventory items')
        .option('--location-id <id>', 'filter by location ID')
        .option('--product-id <id>', 'filter by product ID')
        .option('--all', 'fetch all pages'),
      paramsFor('inventory', 'items'),
    ),
  ).action(
    async (opts: {
      locationId?: string;
      productId?: string;
      all?: boolean;
      query: Record<string, string>;
      output: OutputFormat;
      profile?: string;
    }) => {
      const spinner = ora('Fetching inventory...').start();

      try {
        const bc = createClient(opts.profile);
        const params: Record<string, unknown> = queryParams(opts, paramsFor('inventory', 'items'));

        if (opts.locationId) {
          params.location_id = opts.locationId;
        }

        if (opts.productId) {
          params.product_id = opts.productId;
        }

        let data: unknown;

        if (opts.all) {
          data = await bc.getAllV3('inventory/items', params);
        } else {
          const res: { data?: unknown } = await bc.get('v3', 'inventory/items', params);

          data = res.data;
        }

        spinner.stop();
        print(data, opts.output, INVENTORY_FIELDS);
      } catch (e) {
        spinner.fail();
        errorOut((e as Error).message);
      }
    },
  );

  addOpts(
    inventory
      .command('update')
      .description('Set absolute inventory quantity for a product/variant at a location')
      .requiredOption('--location-id <id>', 'location ID')
      .requiredOption('--product-id <id>', 'product ID')
      .option('--variant-id <id>', 'variant ID (optional)')
      .requiredOption('--quantity <n>', 'quantity to set'),
  ).action(
    async (opts: {
      locationId: string;
      productId: string;
      variantId?: string;
      quantity: string;
      output: OutputFormat;
      profile?: string;
    }) => {
      const spinner = ora('Updating inventory...').start();

      try {
        const bc = createClient(opts.profile);
        const item: Record<string, unknown> = {
          product_id: parseInt(opts.productId, 10),
          location_id: parseInt(opts.locationId, 10),
          quantity: parseInt(opts.quantity, 10),
        };

        if (opts.variantId) {
          item.variant_id = parseInt(opts.variantId, 10);
        }

        const res: { data?: unknown } = await bc.put('v3', 'inventory/adjustments/absolute', {
          items: [item],
        });

        spinner.stop();
        success(
          `Inventory updated (product ${opts.productId}, location ${opts.locationId}, qty ${opts.quantity})`,
        );
        print(res.data, opts.output);
      } catch (e) {
        spinner.fail();
        errorOut((e as Error).message);
      }
    },
  );
}
