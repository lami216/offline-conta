import type { FinancialMovement, Party, PaymentAccount } from "./domain";

export type CommittedPeriod = { from: string; to: string } | null;
export const inCommittedPeriod = (occurredAt: string, period: CommittedPeriod) => !period || ((!period.from || occurredAt.slice(0, 10) >= period.from) && (!period.to || occurredAt.slice(0, 10) <= period.to));
export function financialMovementKind(type: unknown) { const value=String(type??""); if(value.startsWith("sale:"))return "sale"; if(value.startsWith("purchase:"))return "purchase"; return value; }
export function filterFinancialMovements(rows: FinancialMovement[], period: CommittedPeriod, accountId = "", type = "") { return rows.filter(row => inCommittedPeriod(row.occurredAt, period) && (!accountId || row.paymentMethod === accountId) && (!type || financialMovementKind(row.type) === type)); }
export function filterTransfers<T extends { occurredAt: string; fromAccountId: string; toAccountId: string }>(rows: T[], period: CommittedPeriod, fromAccountId = "", toAccountId = "") { return rows.filter(row => inCommittedPeriod(row.occurredAt, period) && (!fromAccountId || row.fromAccountId === fromAccountId) && (!toAccountId || row.toAccountId === toAccountId)); }
const nonOperatingMovementTypes = new Set(["transfer-in", "transfer-out", "opening-balance", "opening-balance-correction", "balance-correction"]);
export const bankSummaryMovementKinds = {
  in: ["sale","party-receipt","manual-deposit"],
  out: ["purchase","expense","party-payment","manual-withdrawal"],
} as const;
export type BankSummaryMovementBreakdown = { kind:string; count:number; value:number };
export function bankScopeBreakdown(accounts: PaymentAccount[], movements: FinancialMovement[], parties: Party[]) {
  const accountsUsed=accounts.filter(account=>!account.isArchived).map(account=>({id:account.id,name:account.name,isActive:account.isActive,value:Number(account.balance||0)}));
  const operating=movements.filter(movement=>!nonOperatingMovementTypes.has(financialMovementKind(movement.type)));
  const movementRows=(direction:"in"|"out"):BankSummaryMovementBreakdown[]=>{
    const configured=[...bankSummaryMovementKinds[direction]] as string[];
    const found=[...new Set(operating.filter(movement=>movement.direction===direction).map(movement=>financialMovementKind(movement.type)))];
    const kinds=[...configured,...found.filter(kind=>!configured.includes(kind))];
    return kinds.map(kind=>{
      const matching=operating.filter(movement=>movement.direction===direction&&financialMovementKind(movement.type)===kind);
      return {kind,count:matching.length,value:matching.reduce((sum,movement)=>sum+Number(movement.amount||0),0)};
    });
  };
  const partyRows=parties.map(party=>{const net=Number(party.receivable||0)-Number(party.payable||0);return{id:party.id,name:party.name,partyType:party.partyType,isArchived:party.isArchived===true,owedToUs:Math.max(net,0),weOwe:Math.max(-net,0)}});
  return {accounts:accountsUsed,income:movementRows("in"),expenses:movementRows("out"),parties:partyRows};
}
export function bankScopeMetrics(accounts: PaymentAccount[], movements: FinancialMovement[], parties: Party[]) {
  const currentBalance = accounts.filter(account => !account.isArchived).reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const operating = movements.filter(movement => !nonOperatingMovementTypes.has(financialMovementKind(movement.type)));
  const income = operating.filter(movement => movement.direction === "in").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const expenses = operating.filter(movement => movement.direction === "out").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const debt = parties.reduce((totals, party) => { const net = Number(party.receivable || 0) - Number(party.payable || 0); if (net > 0) totals.owedToUs += net; else totals.weOwe += Math.abs(net); return totals; }, { owedToUs: 0, weOwe: 0 });
  return { currentBalance, income, expenses, ...debt };
}
