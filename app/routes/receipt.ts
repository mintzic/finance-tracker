import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Route } from './+types/receipt';
import { requireUser } from '../lib/auth.server';
import { sqlite } from '../db/connection.server';
import { receiptDirectory } from '../lib/receipts.server';
export async function loader({request,params}:Route.LoaderArgs) {
  const user=await requireUser(request);
  if(!/^[a-f0-9-]{36}$/.test(params.id)) throw new Response('Not found',{status:404});
  const receipt=sqlite.prepare('SELECT * FROM receipts WHERE id=? AND user_id=?').get(params.id,user.id) as {filename:string;mime:string}|undefined;
  if(!receipt) throw new Response('Not found',{status:404});
  let bytes:Buffer;try{bytes=await readFile(resolve(receiptDirectory,params.id));}catch{throw new Response('Receipt file unavailable. Restore it from backup.',{status:404});}
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':receipt.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(receipt.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
