import { ResourceSpec } from '../resource';

const METAFIELD_FIELDS = ['id', 'namespace', 'key', 'value', 'permission_set', 'resource_type', 'resource_id'];

/**
 * Metafields hang off most V3 resources with an identical shape, so every one
 * of them is the same spec with a different parent path.
 */
export function metafields(parentPath: string): ResourceSpec {
  return {
    name: 'metafields',
    describe: 'Metafields',
    path: `${parentPath}/metafields`,
    style: 'v3-item',
    idLabel: 'metafield',
    fields: METAFIELD_FIELDS,
    params: ['key', 'namespace', 'direction'],
  };
}

/** The batch form — one call across every parent of a type. */
export function batchMetafields(path: string, deleteQuery = 'id:in'): ResourceSpec {
  return {
    name: 'all-metafields',
    describe: 'Metafields across every parent',
    path,
    style: 'v3-batch',
    idLabel: 'metafield',
    deleteQuery,
    fields: METAFIELD_FIELDS,
    params: ['key', 'namespace', 'resource_id:in'],
  };
}
