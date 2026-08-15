/**
 * REAL-BROWSER click test for the Petty Cash "Expense breakdown" (ReceiptText) button.
 * Headless Edge via CDP. Modes:
 *   A = click on a pc with 0 entries -> expects empty state
 *   B = add 1 utilization via API first -> click -> entry visible
 *   C = add 2 utilizations via API first -> click -> both rows + running totals
 *
 * Usage: node browser-click-test.js <origin> <email> <password> <mode>
 * For mode A you may pass <projectName> <pcDescription> to target existing rows.
 */
const ORIGIN = process.argv[2];
const EMAIL = process.argv[3];
const PASSWORD = process.argv[4];
const MODE = (process.argv[5] || 'A').toUpperCase();
const PROJECT = process.argv[6];
const PC_DESC = process.argv[7];
const CDP_PORT = process.env.CDP_PORT || '9333';
const TS = Date.now();

const api = async (m, p, t, b) => {
  const r = await fetch(`${ORIGIN}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};

(async () => {
  const login = (await api('POST', '/auth/login', null, { email: EMAIL, password: PASSWORD }));
  const token = login.j.token;
  const adminLogin = (await api('POST', '/auth/login', null, { email: 'admin@ims.com', password: PASSWORD }));
  const adminToken = adminLogin.j.token;

  let projId, pc, pcDesc, projName;
  if (MODE === 'A' && PROJECT) {
    const projects = (await api('GET', '/projects', token)).j;
    const proj = projects.find(p => p.name === PROJECT);
    if (!proj) { console.error(`project ${PROJECT} not found`); process.exit(2); }
    const pcs = (await api('GET', `/projects/${proj.id}/finance/petty-cash`, token)).j || [];
    pc = pcs.find(p => p.status === 'active' && p.description === PC_DESC) || pcs.find(p => p.description === PC_DESC);
    if (!pc) { console.error(`petty cash "${PC_DESC}" not found in ${PROJECT}`); process.exit(2); }
    projId = proj.id; projName = proj.name; pcDesc = pc.description;
  } else {
    // throwaway fixture for B/C (and A with no args)
    projName = `QA UBX ${TS}`;
    const created = (await api('POST', '/projects', adminToken, { name: projName, client: 'QA', status: 'active', project_cost_value: '1000000' },)).j;
    projId = created.id;
    pcDesc = `UBX ${TS}`;
    const banks = (await api('GET', '/banks', token)).j || [];
    const bankId = banks[0] && banks[0].id;
    if (!bankId) { console.error('no bank available for fixture'); process.exit(2); }
    pc = (await api('POST', `/projects/${projId}/finance/petty-cash`, token, { description: pcDesc, amount: 1000, week_of: '2026-08-15', bank_id: bankId })).j;
    if (MODE === 'B') {
      await api('POST', `/projects/${projId}/finance/petty-cash/${pc.id}/utilizations`, token, { category: 'Material', date: '2026-08-15', amount: 400, note: 'UBX-NOTE-1', receipt_ref: 'UBX-R-1' });
    } else if (MODE === 'C') {
      await api('POST', `/projects/${projId}/finance/petty-cash/${pc.id}/utilizations`, token, { category: 'Material', date: '2026-08-15', amount: 400, note: 'UBX-NOTE-1', receipt_ref: 'UBX-R-1' });
      await api('POST', `/projects/${projId}/finance/petty-cash/${pc.id}/utilizations`, token, { category: 'Labor', date: '2026-08-16', amount: 600, note: 'UBX-NOTE-2', receipt_ref: 'UBX-R-2' });
    }
  }

  // --- CDP ---
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) { console.error('no page target'); process.exit(2); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0; const pending = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).res(msg.result); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const navigate = async () => {
    await send('Page.navigate', { url: `${ORIGIN}/` });
    await sleep(3000);
    await evalJs(`(async () => {
      const r = await fetch('${ORIGIN}/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '${EMAIL}', password: '${PASSWORD}' }) });
      const d = await r.json();
      localStorage.setItem('ims_token', d.token); localStorage.setItem('ims_user', JSON.stringify(d.user));
      location.href = '/projects?project=${projId}&tab=finance'; return 'NAV';
    })()`);
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(500);
      ok = await evalJs(`!!document.querySelector('button[title="Expense breakdown"]') && document.body.innerText.includes('${pcDesc.slice(0, 25)}')`);
    }
    return ok;
  };

  let fails = 0;
  const check = (name, ok, detail) => { console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

  console.log(`\n=== MODE ${MODE} :: ${ORIGIN} :: project=${projName} pc="${pcDesc}" (ts=${TS}) ===`);
  const loaded = await navigate();
  check('finance tab loaded with petty cash rows', loaded);
  if (!loaded) { console.error('  aborting: finance tab never loaded'); process.exit(2); }

  await evalJs(`(() => {
    window.__errs = []; window.__cons = [];
    window.addEventListener('error', e => window.__errs.push('error: ' + (e.error ? (e.error.stack || e.error.message) : e.message)));
    window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
    const orig = console.error; console.error = (...a) => { window.__cons.push(a.map(x => x instanceof Error ? x.stack || x.message : String(x)).join(' ')); orig.apply(console, a); };
  })()`);
  const clicked = await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('button[title="Expense breakdown"]'));
    const btn = btns.find(b => b.closest('tr') && b.closest('tr').innerText.includes('${pcDesc.slice(0, 25)}')) || btns[0];
    if (!btn) return 'NO_BUTTON'; btn.click(); return 'CLICKED';
  })()`);
  check('doc icon clicked', clicked === 'CLICKED', clicked);
  await sleep(2500);
  const dbg = await evalJs(`JSON.stringify({
    rootLen: (document.querySelector('#root')?.innerHTML || '').length,
    errs: window.__errs || [], cons: (window.__cons || []).slice(-3),
    text: document.body.innerText
  })`);
  const d = JSON.parse(dbg);
  check('NO uncaught JS exception after click', d.errs.length === 0, d.errs[0] || '');
  check('no console.error after click', d.cons.length === 0, d.cons[0] || '');
  check('page body intact (no white page)', d.rootLen > 1000 && d.text.length > 200);
  check('modal open with Petty Cash Expenses title', d.text.includes('Petty Cash Expenses:'));
  if (MODE === 'A') {
    check('empty state shown ("No utilization entries yet")', d.text.includes('No utilization entries yet') && d.text.includes('Add one to get started'));
  } else {
    check('entry UBX-NOTE-1 visible', d.text.includes('UBX-NOTE-1'));
    if (MODE === 'C') {
      check('entry UBX-NOTE-2 visible', d.text.includes('UBX-NOTE-2'));
      check('running total Rs. 1,000 shown', d.text.includes('Rs. 1,000'));
    }
  }
  const tail = await evalJs(`document.body.innerText.slice(-500).replace(/\\s+/g, ' ')`);
  console.log(`  [modal tail] ${tail.slice(0, 240)}`);
  console.log(`\n  MODE ${MODE} RESULT: ${fails === 0 ? 'PASS' : 'FAIL'} (${fails} failed)`);
  ws.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS FATAL:', e); process.exit(3); });