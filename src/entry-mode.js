// Browser entry point: only a local development hostname may open the demo.
// Hosted sites always default to authenticated Supabase; the legacy Node server
// remains available when the server explicitly stamps the page's meta tag.
export function selectProntoEntry({hostname='',search='',siteMode=''}={}) {
 const host=String(hostname).toLowerCase();
 const local=['localhost','127.0.0.1','::1','[::1]'].includes(host);
 const query=new URLSearchParams(String(search).replace(/^\?/,''));
 if(query.get('auth-check')==='1'||query.get('mode')==='supabase')return 'supabase';
 if(siteMode==='server')return local&&query.get('demo')==='1'?'demo':'server';
 if(local&&query.get('mode')==='server')return 'server';
 return local?'demo':'supabase';
}
