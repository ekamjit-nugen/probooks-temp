/**
 * @probooks/no-cross-tenant (STANDARDS §9.3)
 *
 * Fails the build when a Prisma query method (findMany/findFirst/findUnique/
 * update/updateMany/delete/deleteMany/count/aggregate) is given a `where`
 * object literal that does not include a `tenantId` key.
 *
 * This is the static backstop for the multi-tenancy enforcement pattern:
 * every query must be tenant-scoped. RLS (DB) is the runtime backstop; this
 * rule is the compile-time one. Repositories read tenantId from context
 * (TenantContextService) — it must still appear in the where clause.
 *
 * Heuristic by design (lint, not a type system): a query whose `where` is a
 * spread/variable rather than an object literal is reported as needing manual
 * review via the `allowNonLiteralWhere` option (default false).
 */
const TENANT_SCOPED_METHODS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** @type {import('eslint').Rule.RuleModule} */
export const noCrossTenant = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require tenantId in every Prisma where clause (STANDARDS §9.3, INV-TEN-1).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowNonLiteralWhere: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingTenant:
        "Prisma '{{method}}' where clause is missing 'tenantId' (STANDARDS §9.3, INV-TEN-1). Tenant scope is mandatory on every query.",
      nonLiteralWhere:
        "Prisma '{{method}}' where clause is not an object literal; cannot statically verify 'tenantId'. Inline the where or annotate why this is safe.",
    },
  },
  create(context) {
    const opts = context.options[0] ?? {};
    const allowNonLiteralWhere = opts.allowNonLiteralWhere === true;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        if (!TENANT_SCOPED_METHODS.has(method)) return;

        const arg = node.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') return; // not a Prisma-style call we can read

        const whereProp = arg.properties.find(
          (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
        );
        if (!whereProp) return; // create/connect etc. — no where to scope

        const where = whereProp.value;
        if (where.type !== 'ObjectExpression') {
          if (!allowNonLiteralWhere) {
            context.report({ node: where, messageId: 'nonLiteralWhere', data: { method } });
          }
          return;
        }

        const hasTenant = where.properties.some(
          (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'tenantId',
        );
        if (!hasTenant) {
          context.report({ node: where, messageId: 'missingTenant', data: { method } });
        }
      },
    };
  },
};

export const plugin = {
  rules: {
    'no-cross-tenant': noCrossTenant,
  },
};

export default plugin;
