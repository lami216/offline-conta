import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteDatabase, ensureDatabaseSchema } from '../lib/sqlite.ts';
import { createNativeBackup, stringifyBackup, parseAndValidateBackup, restoreNativeBackup } from '../lib/backup.ts';
import { execute } from '../app/api/command/route.ts';
import { accrueDueEmployees, handlePayrollCommand } from '../lib/payroll.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';

async function fixture(t) {
  const db = new SqliteDatabase(new Database(':memory:'));
  t.after(() => db.close());
  ensureDatabaseSchema(db);
  await db.dropDatabase();
  await db.collection('warehouses').insertOne({ _id: 'w', name: 'Synthetic warehouse', isSalesDefault: true });
  await db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', isActive: true, balance: 10000 });
  await db.collection('products').insertOne({ id: 'p', sku: '1', name: 'Synthetic product', stocks: { w: 0 }, piecePrice: 150 });
  const command = body => db.transaction(session => execute(db, session, body));
  const snapshot = () => Promise.all(['documents', 'stockMovements', 'financialMovements', 'products', 'paymentAccounts', 'parties'].map(name => db.collection(name).find().toArray()));
  await command({ type: 'purchase.post', warehouseId: 'w', paymentMethod: 'cash', lines: [{ productId: 'p', quantity: 3, unitPrice: 100.2 }] });
  return { db, command, snapshot };
}

test('v8 upgrade adds worker storage without changing existing accounting, and schema1 old backups remain restorable', async t => {
  const f = await fixture(t), before = await f.snapshot();
  f.db.native.exec('DROP TABLE employees; DROP INDEX payroll_period_unique; DELETE FROM schema_migrations WHERE version=9;');
  ensureDatabaseSchema(f.db);
  ensureDatabaseSchema(f.db);
  assert.equal(f.db.native.prepare('SELECT max(version) version FROM schema_migrations').get().version, 9);
  assert.equal(await f.db.collection('employees').countDocuments(), 0);
  assert.deepEqual(await f.snapshot(), before);
  const old = await createNativeBackup(f.db);
  delete old.collections.employees; delete old.counts.employees;
  old.appVersion = '0.1.18'; delete old.build;
  const parsed = parseAndValidateBackup(stringifyBackup(old));
  assert.equal(parsed.schemaVersion, 1);
  assert.deepEqual(parsed.collections.employees, []);
  await f.db.transaction(session => restoreNativeBackup(f.db, parsed, session));
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.db.collection('documents').findOne({ kind: 'purchase' })).total, 301);
});

test('new worker backup restores accruals, payments and liability with cash, stock and period reports unchanged', async t => {
  const f = await fixture(t), at = new Date('2026-11-01T15:00:00.000Z');
  const worker = await handlePayrollCommand(f.db, {}, { type: 'employee.create', name: 'Synthetic worker', amount: 500, startDate: '2026-11-01', intervalMonths: 1, entitlement: 'beginning' }, at);
  await accrueDueEmployees(f.db, {}, { asOf: '2026-11-01', now: at, context: 'synthetic-upgrade-test' });
  await handlePayrollCommand(f.db, {}, { type: 'employee-payment.post', employeeId: worker, direction: 'withdraw', amount: 200, paymentMethod: 'cash', occurredAt: '2026-11-02' }, new Date('2026-11-02T15:00:00.000Z'));
  const filters = parseReportFilters(new URL('http://local/?type=overview&allTime=true&unpaged=true'));
  const before = await f.snapshot(), overview = await buildReport(f.db, filters);
  assert.deepEqual([overview.summary.expenses, overview.summary.workersAccrued, overview.summary.workersExpense, overview.summary.workersReserveChange, overview.summary.ownerAvailableProfit], [200, 500, 200, 300, -500]);
  assert.equal(overview.summary.currentWorkersOwed, 300);
  const backup = parseAndValidateBackup(stringifyBackup(await createNativeBackup(f.db)));
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.collections.employees.length, 1);
  await f.db.transaction(session => restoreNativeBackup(f.db, backup, session));
  assert.deepEqual(await f.snapshot(), before);
  assert.deepEqual(await buildReport(f.db, filters), overview);
  assert.equal((await f.db.collection('employees').findOne({ id: worker })).balance, 300);
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: 'cash' })).balance, 9499);
  const invalid = structuredClone(backup);
  invalid.collections.employees[0].balance = 301;
  assert.throws(() => parseAndValidateBackup(stringifyBackup(invalid)), /العامل|الموظف/);
  assert.deepEqual(await f.snapshot(), before);
});
