const BASE = process.env.BASE_URL || 'https://ims-construction.vercel.app';
const PASSWORD = process.env.QA_PASSWORD || 'ImsQa!Pass2026';

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`LOGIN FAIL ${email}: ${r.status} ${JSON.stringify(j)}`); return null; }
  return j.token;
}

async function api(token, path, opts = {}) {
  const r = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j };
}

(async () => {
  const health = await fetch(`${BASE}/api/health`).then(r => r.json()).catch(e => ({ error: e.message }));
  console.log('HEALTH:', JSON.stringify(health));
  for (const role of ['admin', 'owner', 'finance', 'pm', 'procurement', 'store']) {
    const token = await login(`qa-${role}@ims.com`);
    if (!token) continue;
    const me = await api(token, '/auth/me');
    console.log(`AUTH ${role}:`, me.status, me.data?.role || JSON.stringify(me.data));
    if (role === 'admin') {
      const pos = await api(token, '/purchase-orders');
      console.log('POs:', pos.status, JSON.stringify((pos.data || []).slice(0, 5).map(p => ({ n: p.po_number, s: p.status, proj: p.project_name }))));
      const projs = await api(token, '/projects');
      console.log('projects:', projs.status, projs.data?.length, (projs.data || []).slice(0, 3).map(p => p.name));
      const pcy = await api(token, '/projects/' + projs.data[0].id + '/finance/petty-cash');
      console.log('petty-cash[0] count:', pcy.status, pcy.data?.length);
    }
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1) });