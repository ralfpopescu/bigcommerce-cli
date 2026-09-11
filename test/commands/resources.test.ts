import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { client, printed, resetClient, run, succeeded } from './setup';

vi.mock('../../src/api/factory', () => ({ createClient: vi.fn(() => client) }));
vi.mock('ora', async () => {
  const { fakeOra } = await import('./setup');

  return { default: () => fakeOra() };
});
vi.mock('../../src/output', async () => {
  const actual = await vi.importActual<typeof import('../../src/output')>('../../src/output');

  return {
    ...actual,
    print: (data: unknown) => {
      printed.push(data);
    },
    success: (msg: string) => {
      succeeded.push(msg);
    },
    info: vi.fn(),
  };
});

import { registerChannels } from '../../src/commands/channels';
import { registerCustomers } from '../../src/commands/customers';
import { registerInventory } from '../../src/commands/inventory';
import { registerOrders } from '../../src/commands/orders';

function program(register: (p: Command) => void): Command {
  const p = new Command();

  p.exitOverride();
  register(p);

  return p;
}

beforeEach(resetClient);

describe('orders', () => {
  it('lists orders from V2 without unwrapping', async () => {
    client.get.mockResolvedValue([{ id: 100, status: 'Pending' }]);

    await run(program(registerOrders), ['orders', 'list']);

    expect(printed[0]).toEqual([{ id: 100, status: 'Pending' }]);
  });

  it('auto-paginates orders with --all', async () => {
    client.getAllV2.mockResolvedValue([{ id: 100 }]);

    await run(program(registerOrders), ['orders', 'list', '--all']);

    expect(client.getAllV2).toHaveBeenCalled();
  });

  it('filters orders by a named parameter', async () => {
    client.get.mockResolvedValue([]);

    await run(program(registerOrders), ['orders', 'list', '--customer-id', '5']);

    expect(client.get).toHaveBeenCalledWith(
      'v2',
      'orders',
      expect.objectContaining({ customer_id: '5' }),
    );
  });

  it('gets an order by id', async () => {
    client.get.mockResolvedValue({ id: 145 });

    await run(program(registerOrders), ['orders', 'get', '145']);

    expect(printed[0]).toMatchObject({ id: 145 });
  });

  it('updates an order status', async () => {
    client.put.mockResolvedValue({ id: 145, status_id: 10 });

    await run(program(registerOrders), ['orders', 'update', '145', '--status', '10']);

    expect(succeeded.join(' ')).toMatch(/145/);
  });

  it('reports a failure', async () => {
    client.get.mockRejectedValue(new Error('404: Not Found'));

    await expect(run(program(registerOrders), ['orders', 'get', '1'])).rejects.toThrow(
      '404: Not Found',
    );
  });
});

describe('customers', () => {
  it('lists customers', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, email: 'a@example.test' }] });

    await run(program(registerCustomers), ['customers', 'list']);

    expect(printed[0]).toEqual([{ id: 1, email: 'a@example.test' }]);
  });

  it('supports the colon-suffixed filter options the API uses', async () => {
    client.get.mockResolvedValue({ data: [] });

    await run(program(registerCustomers), ['customers', 'list', '--email:in', 'a@example.test']);

    expect(client.get).toHaveBeenCalledWith(
      'v3',
      'customers',
      expect.objectContaining({ 'email:in': 'a@example.test' }),
    );
  });

  it('creates a customer', async () => {
    client.post.mockResolvedValue({ data: [{ id: 2 }] });
    client.request.mockResolvedValue({ data: [{ id: 2 }] });

    await run(program(registerCustomers), [
      'customers',
      'create',
      '--data',
      '{"email":"a@example.test"}',
    ]);

    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('deletes a customer', async () => {
    await run(program(registerCustomers), ['customers', 'delete', '2']);

    expect(succeeded.join(' ')).toMatch(/deleted/i);
  });
});

describe('channels', () => {
  it('lists channels', async () => {
    client.get.mockResolvedValue({ data: [{ id: 1, name: 'Storefront' }] });

    await run(program(registerChannels), ['channels', 'list']);

    expect(printed[0]).toEqual([{ id: 1, name: 'Storefront' }]);
  });

  it('gets a channel by id', async () => {
    client.get.mockResolvedValue({ data: { id: 1 } });

    await run(program(registerChannels), ['channels', 'get', '1']);

    expect(printed[0]).toMatchObject({ id: 1 });
  });
});

describe('inventory', () => {
  it('lists inventory items', async () => {
    client.get.mockResolvedValue({ data: [{ sku: 'A-1', available_to_sell: 4 }] });

    await run(program(registerInventory), ['inventory', 'list']);

    expect(printed[0]).toEqual([{ sku: 'A-1', available_to_sell: 4 }]);
  });

  it('scopes a listing to a location', async () => {
    client.get.mockResolvedValue({ data: [] });

    await run(program(registerInventory), ['inventory', 'list', '--location-id', '1']);

    expect(client.get).toHaveBeenCalledWith(
      'v3',
      'inventory/items',
      expect.objectContaining({ location_id: '1' }),
    );
  });

  it('adjusts a quantity', async () => {
    client.put.mockResolvedValue({ data: {} });
    client.request.mockResolvedValue({ data: {} });

    await run(program(registerInventory), [
      'inventory',
      'update',
      '--location-id',
      '1',
      '--product-id',
      '329',
      '--quantity',
      '10',
    ]);

    expect(succeeded.length + printed.length).toBeGreaterThan(0);
  });
});
