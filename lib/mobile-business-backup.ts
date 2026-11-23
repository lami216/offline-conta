import type { ContaBackup } from './backup.ts';

export const MOBILE_BUSINESS_FORMAT = 'alkarna-mobile-business-backup';
const COLLECTIONS = ['employees', 'parties', 'warehouses', 'products', 'productCategories', 'expenseCategories', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'recurringExpenses', 'accountTransfers', 'counters', 'auditEvents', 'appSettings', 'users', 'importMappings'] as const;
const fail = (): never => { throw new Error('ملف تبادل بيانات الهاتف غير صالح؛ لم تتغير بيانات الجهاز'); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function withoutCredentials(value: unknown, depth = 0): void {
  if (depth > 80) fail();
  if (Array.isArray(value)) { for (const row of value) withoutCredentials(row, depth + 1); return; }
  if (!object(value)) return;
  if (value.format === 'conta-backup' && object(value.collections) && (!Array.isArray(value.collections.users) || value.collections.users.length)) fail();
  if (value.format === 'alkarna-web-backup' && object(value.state) && (!Array.isArray(value.users) || value.users.length || Array.isArray(value.state.users) && value.state.users.length)) fail();
  for (const row of Object.values(value)) withoutCredentials(row, depth + 1);
}

/** Transport recognition only. The caller must run the existing canonical
 * invariant validator before assigning its internal credentials-preserving tag.
 * No command, balance, payroll, cost or source-version rule is weakened here. */
export function readMobileBusinessBackup(value: unknown): ContaBackup {
  if (!object(value) || value.format !== MOBILE_BUSINESS_FORMAT || value.schemaVersion !== 1 ||
      Object.keys(value).some(key => !['format', 'schemaVersion', 'createdAt', 'source', 'backup'].includes(key)) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      !object(value.source) || value.source.application !== 'alkarna-mobile' || value.source.featureSchema !== 4 || value.source.businessOnly !== true ||
      typeof value.source.originId !== 'string' || !value.source.originId || value.source.originId.length > 200 ||
      Object.keys(value.source).some(key => !['application', 'featureSchema', 'originId', 'businessOnly'].includes(key)) || !object(value.backup)) fail();
  const backup = structuredClone(value.backup);
  if (backup.format !== 'conta-backup' || backup.schemaVersion !== 1 || backup.encoding !== 'json-v2' || backup.createdAt !== value.createdAt || !object(backup.collections)) fail();
  const collections = backup.collections;
  if (Object.keys(collections).length !== COLLECTIONS.length ||
      Object.keys(collections).some(key => !COLLECTIONS.includes(key as typeof COLLECTIONS[number])) ||
      COLLECTIONS.some(name => !Array.isArray(collections[name])) || (collections.users as unknown[]).length) fail();
  withoutCredentials(backup);
  delete backup.mobileImport;
  return backup as unknown as ContaBackup;
}
