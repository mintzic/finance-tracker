import type { Route } from './+types/export';
import { sqlite } from '../db/connection.server';
import { csvHeaders, csvCell } from '../lib/import.server';
import { decimal } from '../lib/money';
import { deductSubscriptions } from '../lib/subscriptions.server';
export async function loader({request}:Route.LoaderArgs) {
  deductSubscriptions(sqlite);
  const rows=sqlite.prepare('SELECT e.*,w.name account,d.name destination FROM entries e JOIN wallets w ON w.id=e.wallet_id LEFT JOIN wallets d ON d.id=e.destination_id ORDER BY e.date,e.id').iterate();
  const encoder=new TextEncoder();
  const stream=new ReadableStream({start(controller){controller.enqueue(encoder.encode(csvHeaders.join(',')+'\r\n'));},pull(controller){const next=rows.next();if(next.done){controller.close();return;}const e=next.value as any;controller.enqueue(encoder.encode([e.date,e.kind,e.description,decimal(e.amount),e.account,e.destination,e.category,e.notes].map(csvCell).join(',')+'\r\n'));},cancel(){rows.return?.();}});
  return new Response(stream,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="finance-all-transactions.csv"','Cache-Control':'private, no-store'}});
}
