import { Form, redirect, useNavigation } from 'react-router';
import { Wallet } from 'lucide-react';
import type { Route } from './+types/login';
import { getAuth, sameOrigin } from '../lib/auth.server';
import { allowLogin } from '../lib/login-limit.server';
import { boundedForm } from '../lib/receipts.server';
export function headers() {return {'Cache-Control':'private, no-store'};}
export async function loader({request}:Route.LoaderArgs) { if(await getAuth().api.getSession({headers:request.headers})) throw redirect('/');return null; }
export async function action({request}:Route.ActionArgs) {
  sameOrigin(request);
  const form=await boundedForm(request);
  const email=String(form.get('email')||'').trim().toLowerCase();
  if(email.length>254 || !allowLogin(email)) return {error:'Too many sign-in attempts. Please try again in 15 minutes.'};
  const response=await getAuth().api.signInEmail({body:{email:String(form.get('email')||''),password:String(form.get('password')||'')},headers:request.headers,asResponse:true});
  if(!response.ok) return {error:'Unable to sign in. Check your email and password.'};
  const headers=new Headers();
  for(const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie',cookie);
  return redirect('/',{headers});
}
export default function Login({actionData}:Route.ComponentProps) {
  const pending=useNavigation().state!=='idle';
  return <main className="login"><div className="login-card"><div className="brand-mark"><Wallet size={24}/></div><p className="eyebrow">PERSONAL FINANCE</p><h1>A little clarity.<br/>A lot of possibility.</h1><p className="muted">Sign in to your private financial workspace.</p><Form method="post" className="form-stack"><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{actionData?.error && <p role="alert" className="error">{actionData.error}</p>}<button className="primary" disabled={pending}>{pending?'Signing in…':'Sign in →'}</button></Form><p className="small muted">SGD · Asia/Singapore · Your data, your space.</p></div></main>;
}
