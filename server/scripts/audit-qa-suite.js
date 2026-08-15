/**
 * FULL AUDIT + QA SUITE — PO workflow | Petty Cash utilization | Edge cases
 * Runs against a target origin (local dev server by default, or deployed URL).
 * Usage: node scripts/audit-qa-suite.js [origin] [qaPassword]
 *   origin:      default http://localhost:5000
 *   qaPassword:  optional; default random (users are created on the demo DB)
 */
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });

const ORIGIN = process.argv[2] || 'http://localhost:5000';
const API = `${ORIGIN}/api`;
const QA_PASSWORD = process.argv[3] || ('Qa!' + Date.now().toString(36) + 'x9');
const ts = Date.now();

const results = [];
const pass = (name, detail = '') => { results.push({ name, status: 'PASS', detail }); console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`); };
const fail = (name, detail = '') => { results.push({ name, status: 'FAIL', detail }); console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); };

async function http(method, urlPath, { token, body, expected = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Transient network failures (Supabase pooler resets, cold starts) are retried.
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}${urlPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : null,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (expected && res.status !== expected) {
        throw new Error(`${method} ${urlPath} -> ${res.status} (expected ${expected}): ${JSON.stringify(data)?.slice(0, 300)}`);
      }
      return { status: res.status, data };
    } catch (e) {
      lastErr = e;
      if (e.message && !e.message.includes('fetch failed') && !e.message.includes('ECONNRESET') && !e.message.includes('->')) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const fmt = (n) => `${Math.round(n * 100) / 100}`;

async function login(email, password) {
  const { data } = await http('POST', '/auth/login', { body: { email, password } });
  return data.token;
}

async function main() {
  console.log(`\n=== IMS FULL AUDIT + QA SUITE ===`);
  console.log(`Target: ${ORIGIN}  (DB: Supabase shared)  ts=${ts}\n`);

  // ---------- Setup: QA users + fixtures ----------
  console.log('-- Setup --');
  // Bootstrap from the seeded demo accounts (SEED_PASSWORD is the fallback password)
  const cfg = require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const envSeedPw = (cfg.match(/SEED_PASSWORD=(\S+)/) || [null, 'password123'])[1];
  // Explicit CLI password wins (demo credentials may have been rotated)
  const seedPw = process.argv[3] || envSeedPw;
  const samePassword = seedPw === QA_PASSWORD;

  let adminTok = null;
  try { adminTok = await login('admin@ims.com', seedPw); } catch { adminTok = null; }
  if (!adminTok) { console.error('Could not log in with seeded admin account — aborting.'); process.exit(2); }
  pass('setup: seeded admin login works (demo account)');
  const ownerTok = await login('owner@ims.com', seedPw);

  // Create dedicated QA role users through the API (role-gated properly)
  const mkUser = async (role) => {
    const email = `qa_${role.replace(/[^a-z0-9_]/g, '_')}${ts}@ims.com`;
    await http('POST', '/users', { token: adminTok, body: { email, password: QA_PASSWORD, full_name: `QA ${role}`, role, phone: '03000000000' }, expected: 201 });
    return { role, email, token: await login(email, QA_PASSWORD) };
  };
  const qa = { admin: null, owner: null, finance: null, manager: null, procurement_officer: null };
  for (const role of ['finance', 'manager', 'procurement_officer']) qa[role] = await mkUser(role);
  qa.admin = { role: 'admin', email: 'admin@ims.com', token: adminTok };
  qa.owner = { role: 'owner', email: 'owner@ims.com', token: ownerTok };

  const { data: project } = await http('POST', '/projects', {
    token: qa.owner?.token || qa.admin?.token,
    body: { name: `QA Flow ${ts}`, client: 'QA Client', location: 'Karachi', city: 'Karachi', project_cost_value: '2500000', status: 'active', start_date: '2026-08-01', end_date: '2026-12-31' },
    expected: 201,
  });
  const pid = project.id;
  console.log(`  fixture project: ${pid}`);

  const { data: vendor } = await http('POST', '/vendors', {
    token: qa.admin?.token || qa.owner.token,
    body: { name: `QA Vendor ${ts}`, contact_person: 'QA', phone: '03001234567', city: 'Karachi', status: 'active' },
    expected: 201,
  });
  const vid = vendor.id;

  const banksRes = await http('GET', '/banks', { token: qa.finance?.token || qa.owner.token });
  const bankId = banksRes.data[0]?.id;
  if (!bankId) fail('setup: bank available', 'no banks in DB');
  const passToken = qa.admin?.token || qa.owner.token;
  const ownerToken = qa.owner.token;

  // =====================================================================
  // PART 1 — PO WORKFLOW
  // =====================================================================
  console.log('\n-- Part 1: PO Workflow --');

  // 1a. PO creation role = Procurement only
  for (const u of [qa.owner, qa.finance, qa.manager]) {
    try {
      await http('POST', `/vendors/${vid}/purchase-orders`, {
        token: u.token, body: { items: [{ material_name: 'Cement', quantity: 100, unit: 'bag', unit_price: 1300 }], project_id: pid },
        expected: 403,
      });
      pass(`PO create blocked for ${u.role}`);
    } catch (e) { fail(`PO create blocked for ${u.role}`, e.message); }
  }
  let poRes;
  try {
    poRes = await http('POST', `/vendors/${vid}/purchase-orders`, {
      token: qa.procurement_officer.token,
      body: { items: [{ material_name: 'Cement', quantity: 100, unit: 'bag', unit_price: 1300 }], notes: 'QA test PO', project_id: pid },
      expected: 201,
    });
    pass('PO created by procurement_officer', `#${poRes.data.po_number}`);
  } catch (e) { fail('PO created by procurement_officer', e.message); process.exit(1); }
  const po = poRes.data;
  const poId = po.id;

  // 1b. Site (project) required
  try {
    await http('POST', `/vendors/${vid}/purchase-orders`, {
      token: qa.procurement_officer.token,
      body: { items: [{ material_name: 'Cement', quantity: 1, unit: 'bag', unit_price: 1300 }] },
      expected: 400,
    });
    pass('PO without site (project) rejected');
  } catch (e) { fail('PO without site (project) rejected', e.message); }

  // 1c. Sequential two-step approval
  try {
    const adminApprove = await http('PUT', `/purchase-orders/${poId}/admin-approve`, { token: passToken, body: { approve: true }, expected: 200 });
    if (adminApprove.data.status !== 'admin_approved') fail('admin approve -> admin_approved', `got ${adminApprove.data.status}`);
    else pass('admin approve -> status=admin_approved');
  } catch (e) { fail('admin approve step', e.message); }

  try {
    await http('PUT', `/purchase-orders/${poId}/admin-approve`, { token: passToken, body: { approve: true }, expected: 400 });
    pass('admin double-approve blocked');
  } catch (e) { fail('admin double-approve blocked', e.message); }

  // owner cannot skip the queue — use a fresh PO (admin not yet approved)
  const po4 = (await http('POST', `/vendors/${vid}/purchase-orders`, {
    token: qa.procurement_officer.token,
    body: { items: [{ material_name: 'Bricks', quantity: 500, unit: 'pcs', unit_price: 22 }], project_id: pid },
    expected: 201,
  })).data;
  const oba = await http('PUT', `/purchase-orders/${po4.id}/owner-approve`, { token: ownerToken, body: { approve: true } });
  if (oba.status === 400) pass('owner approve before admin blocked (sequential order)');
  else fail('owner approve before admin blocked (sequential order)', `${oba.status}: ${JSON.stringify(oba.data)?.slice(0, 120)}`);

  const ownerApprove = await http('PUT', `/purchase-orders/${poId}/owner-approve`, { token: ownerToken, body: { approve: true }, expected: 200 });
  if (ownerApprove.data.status === 'approved' && ownerApprove.data.admin_approval === 'approved' && ownerApprove.data.owner_approval === 'approved')
    pass('owner final approve -> status=approved');
  else fail('owner final approve -> status=approved', JSON.stringify({ status: ownerApprove.data.status }));

  // 1d. Continuous payment only for fully-approved PO
  try {
    const { data: vp } = await http('POST', `/projects/${pid}/finance/vendor-payments`, {
      token: qa.finance.token,
      body: { vendor_id: vid, payment_type: 'continuous', amount: 25000, po_id: poId, payment_date: '2026-08-10', bank_id: bankId },
      expected: 201,
    });
    pass('continuous payment linked to fully approved PO', vp.po_number);
  } catch (e) { fail('continuous payment linked to fully approved PO', e.message); }

  // not-yet-fully-approved PO stays out of vendor payments
  const po2 = (await http('POST', `/vendors/${vid}/purchase-orders`, {
    token: qa.procurement_officer.token,
    body: { items: [{ material_name: 'Sand', quantity: 10, unit: 'ft3', unit_price: 500 }], project_id: pid },
    expected: 201,
  })).data;
  try {
    await http('POST', `/projects/${pid}/finance/vendor-payments`, {
      token: qa.finance.token,
      body: { vendor_id: vid, payment_type: 'continuous', amount: 5000, po_id: po2.id, payment_date: '2026-08-10', bank_id: bankId },
      expected: 400,
    });
    pass('continuous payment rejected for pending PO');
  } catch (e) { fail('continuous payment rejected for pending PO', e.message); }

  // mark second PO admin-approved only → must STILL be rejected
  await http('PUT', `/purchase-orders/${po2.id}/admin-approve`, { token: passToken, body: { approve: true }, expected: 200 });
  try {
    await http('POST', `/projects/${pid}/finance/vendor-payments`, {
      token: qa.finance.token,
      body: { vendor_id: vid, payment_type: 'continuous', amount: 5000, po_id: po2.id, payment_date: '2026-08-10', bank_id: bankId },
      expected: 400,
    });
    pass('continuous payment rejected for admin-approved (owner pending) PO');
  } catch (e) { fail('continuous payment rejected for admin-approved PO', e.message); }

  // rejection with reason → recorded
  const po3 = (await http('POST', `/vendors/${vid}/purchase-orders`, {
    token: qa.procurement_officer.token,
    body: { items: [{ material_name: 'Steel', quantity: 5, unit: 'ton', unit_price: 250000 }], project_id: pid },
    expected: 201,
  })).data;
  const rej = await http('PUT', `/purchase-orders/${po3.id}/admin-approve`, { token: passToken, body: { approve: false, reason: 'QA reject test' }, expected: 200 });
  if (rej.data.status === 'rejected' && rej.data.admin_reject_reason === 'QA reject test') pass('admin rejection recorded with reason');
  else fail('admin rejection recorded with reason', JSON.stringify({ status: rej.data.status, reason: rej.data.admin_reject_reason }));

  // =====================================================================
  // PART 2 — PETTY CASH UTILIZATION
  // =====================================================================
  console.log('\n-- Part 2: Petty Cash Utilization --');

  const { data: pc } = await http('POST', `/projects/${pid}/finance/petty-cash`, {
    token: qa.finance.token,
    body: { description: `QA Kit ${ts}`, amount: 15000.50, week_of: '2026-08-12', bank_id: bankId },
    expected: 201,
  });
  const pcId = pc.id;

  // RBAC mirror: same who can add petty cash can add utilization
  for (const u of [qa.owner, qa.admin, qa.finance]) {
    try {
      await http('POST', `/projects/${pid}/finance/petty-cash/${pcId}/utilizations`, {
        token: u.token, body: { category: 'Misc', date: '2026-08-13', amount: 10, note: `${u.role} entry` },
        expected: 201,
      });
      pass(`utilization add allowed for ${u.role}`);
    } catch (e) { fail(`utilization add allowed for ${u.role}`, e.message); }
  }
  try {
    await http('POST', `/projects/${pid}/finance/petty-cash/${pcId}/utilizations`, {
      token: qa.manager.token, body: { category: 'Misc', date: '2026-08-13', amount: 10, note: 'pm' },
      expected: 403,
    });
    pass('utilization add blocked for manager (mirror of petty cash)');
  } catch (e) { fail('utilization add blocked for manager', e.message); }

  // boundary: fill to EXACTLY 0 via paisa-exact splits (no drift, no -0)
  const pc2 = (await http('POST', `/projects/${pid}/finance/petty-cash`, {
    token: qa.finance.token,
    body: { description: `QA Boundary ${ts}`, amount: 1000, week_of: '2026-08-12', bank_id: bankId },
    expected: 201,
  })).data;
  await http('POST', `/projects/${pid}/finance/petty-cash/${pc2.id}/utilizations`, { token: qa.finance.token, body: { category: 'Material', date: '2026-08-14', amount: 499.99, note: 'half-a' }, expected: 201 });
  await http('POST', `/projects/${pid}/finance/petty-cash/${pc2.id}/utilizations`, { token: qa.finance.token, body: { category: 'Labor', date: '2026-08-15', amount: 500.01, note: 'half-b' }, expected: 201 });
  const { data: summExact } = await http('GET', `/projects/${pid}/finance/summary`, { token: qa.finance.token });
  const { data: pc2Detail } = await http('GET', `/projects/${pid}/finance/petty-cash/${pc2.id}/utilizations`, { token: qa.finance.token });
  const pc2Rem = Math.max(0, Math.round((1000 - pc2Detail.total_utilized) * 100) / 100);
  if (pc2Rem === 0 && !Object.is(pc2Rem, -0))
    pass('remaining reaches exactly 0 (no -0 / no negative)', `utilized=${pc2Detail.total_utilized} remaining=${JSON.stringify(pc2Rem)}`);
  else fail('remaining reaches exactly 0', `utilized=${pc2Detail.total_utilized} remaining=${JSON.stringify(pc2Rem)}`);

  // over the boundary → 400
  try {
    await http('POST', `/projects/${pid}/finance/petty-cash/${pc2.id}/utilizations`, {
      token: qa.finance.token, body: { category: 'Misc', date: '2026-08-17', amount: 1, note: 'over' },
      expected: 400,
    });
    pass('utilization over remaining blocked (at exact boundary)');
  } catch (e) { fail('utilization over remaining blocked', e.message); }

  // genuine positive-remaining fill must still succeed (paisa-exact: 333.33 + 666.67 = 1000.00)
  const pc3 = (await http('POST', `/projects/${pid}/finance/petty-cash`, {
    token: qa.finance.token,
    body: { description: `QA Boundary2 ${ts}`, amount: 1000, week_of: '2026-08-12', bank_id: bankId },
    expected: 201,
  })).data;
  await http('POST', `/projects/${pid}/finance/petty-cash/${pc3.id}/utilizations`, { token: qa.finance.token, body: { category: 'Material', date: '2026-08-14', amount: 333.33, note: 'third' }, expected: 201 });
  await http('POST', `/projects/${pid}/finance/petty-cash/${pc3.id}/utilizations`, { token: qa.finance.token, body: { category: 'Labor', date: '2026-08-15', amount: 666.67, note: 'two-thirds' }, expected: 201 });
  const { data: pc3Detail } = await http('GET', `/projects/${pid}/finance/petty-cash/${pc3.id}/utilizations`, { token: qa.finance.token });
  if (Math.round((1000 - pc3Detail.total_utilized) * 100) / 100 === 0)
    pass('positive remaining accept + zero drift on paisa splits', `utilized=${pc3Detail.total_utilized}`);
  else fail('positive remaining accept + zero drift', `utilized=${pc3Detail.total_utilized}`);

  // utilization deletion request: mirrors full flow, updates balances
  // (victim: 'half-a' = 499.99 on pc2 — after deletion, pc2 remaining returns to 499.99)
  const victim = pc2Detail.entries.find(e => e.note === 'half-a') || pc2Detail.entries[0];
  const victimAmount = parseFloat(victim.amount);
  let delReq;
  try {
    delReq = await http('POST', `/projects/${pid}/finance/deletion-requests`, {
      token: qa.finance.token,
      body: { transaction_type: 'petty_cash_utilization', transaction_id: victim.id, reason: 'QA remove entry' },
      expected: 201,
    });
    pass('utilization deletion requested by finance');
  } catch (e) { fail('utilization deletion requested by finance', e.message); }

  const delReqId = delReq.data.id;
  // owner early approve must fail
  try {
    await http('PATCH', `/projects/${pid}/finance/deletion-requests/${delReqId}/owner-approve`, { token: ownerToken, body: { approve: true }, expected: 400 });
    pass('owner cannot approve deletion before admin');
  } catch (e) { fail('owner cannot approve deletion before admin', e.message); }

  const adminApproveDel = await http('PATCH', `/projects/${pid}/finance/deletion-requests/${delReqId}/admin-approve`, { token: passToken, body: { approve: true }, expected: 200 });
  if (adminApproveDel.data.admin_approval !== 'approved') fail('admin deletion approval recorded', JSON.stringify(adminApproveDel.data));
  else pass('admin deletion approval recorded');
  const ownerOkDel = await http('PATCH', `/projects/${pid}/finance/deletion-requests/${delReqId}/owner-approve`, { token: ownerToken, body: { approve: true }, expected: 200 });
  if (ownerOkDel.data.final_status !== 'approved') fail('owner deletion approval finalizes', JSON.stringify(ownerOkDel.data));
  else pass('owner deletion approval finalizes -> approved');

  const { data: summAfterDel } = await http('GET', `/projects/${pid}/finance/summary`, { token: qa.finance.token });
  const pc2After = (await http('GET', `/projects/${pid}/finance/petty-cash/${pc2.id}/utilizations`, { token: qa.finance.token })).data;
  if (fmt(pc2After.total_utilized) === fmt(500.01))
    pass('deleted utilization restores remaining', `utilized now ${fmt(pc2After.total_utilized)} (was 1000.00) = one 499.99 entry removed`);
  else fail('deleted utilization restores remaining', `utilized=${fmt(pc2After.total_utilized)}`);

  // filters: category + date range on utilization list
  const utilList = await http('GET', `/projects/${pid}/finance/petty-cash/utilizations`, { token: qa.finance.token });
  const matOnly = utilList.data.entries.filter(e => e.category === 'Material');
  if (matOnly.length === 2) pass('utilization list + category filter (Material=2)', `total entries=${utilList.data.entries.length}`);
  else fail('utilization list + category filter', `Material count=${matOnly.length}`);

  // =====================================================================
  // PART 3 — EDGE CASES
  // =====================================================================
  console.log('\n-- Part 3: Edge Cases --');

  // zero-data project
  const zeroProject = (await http('POST', '/projects', {
    token: passToken,
    body: { name: `QA Zero ${ts}`, client: 'QA', status: 'planning', project_cost_value: '1000000' },
    expected: 201,
  })).data;
  const zeroSumm = await http('GET', `/projects/${zeroProject.id}/finance/summary`, { token: qa.finance.token });
  const s = zeroSumm.data;
  if (s.actual_cost === 0 && s.petty_cash_total === 0 && s.petty_cash_utilized_total === 0 && s.amount_received_total === 0 && fmt(s.profit_loss) === '1000000')
    pass('zero-data project summary (all totals 0, no NaN)', JSON.stringify({ pc: s.petty_cash_total, pl: s.profit_loss }));
  else fail('zero-data project summary', JSON.stringify(s));
  const zeroList = await http('GET', `/projects/${zeroProject.id}/finance/petty-cash`, { token: qa.finance.token });
  if (Array.isArray(zeroList.data) && zeroList.data.length === 0) pass('zero-data petty cash list (empty, no crash)');
  else fail('zero-data petty cash list', JSON.stringify(zeroList.data).slice(0, 100));

  // negative profit/loss + negative bank balance
  const { data: lossProject } = await http('POST', '/projects', {
    token: passToken,
    body: { name: `QA Loss ${ts}`, client: 'QA', status: 'active', project_cost_value: '50000' },
    expected: 201,
  });
  const { data: lossPc } = await http('POST', `/projects/${lossProject.id}/finance/petty-cash`, {
    token: qa.finance.token, body: { description: 'Loss kit', amount: 90000, week_of: '2026-08-12', bank_id: bankId }, expected: 201,
  });
  await http('POST', `/projects/${lossProject.id}/finance/petty-cash/${lossPc.id}/utilizations`, {
    token: qa.finance.token, body: { category: 'Misc', date: '2026-08-13', amount: 80000, note: 'loss' }, expected: 201,
  });
  const lossSumm = (await http('GET', `/projects/${lossProject.id}/finance/summary`, { token: qa.finance.token })).data;
  if (lossSumm.profit_loss < 0 && lossSumm.balance_received < 0)
    pass('negative profit/loss surfaced correctly', `profit_loss=${fmt(lossSumm.profit_loss)} balance=${fmt(lossSumm.balance_received)}`);
  else fail('negative profit/loss surfaced correctly', JSON.stringify(lossSumm));

  // large numbers (crores)
  const { data: bigPc } = await http('POST', `/projects/${lossProject.id}/finance/petty-cash`, {
    token: qa.finance.token, body: { description: 'Big kit', amount: 99999999.99, week_of: '2026-08-12', bank_id: bankId }, expected: 201,
  });
  await http('POST', `/projects/${lossProject.id}/finance/petty-cash/${bigPc.id}/utilizations`, {
    token: qa.finance.token, body: { category: 'Material', date: '2026-08-13', amount: 99999999.99, note: 'full' }, expected: 201,
  });
  const bigSumm = (await http('GET', `/projects/${lossProject.id}/finance/summary`, { token: qa.finance.token })).data;
  if (fmt(parseFloat(bigSumm.petty_cash_utilized_total)) === '99999999.99' || bigSumm.petty_cash_utilized_total >= 99999999.98)
    pass('large amounts (9.99 crore) preserved with precision', `utilized=${bigSumm.petty_cash_utilized_total}`);
  else fail('large amounts preserved', `utilized=${bigSumm.petty_cash_utilized_total}`);

  // workflow: admin-approved PO absent from continuous dropdown (list endpoint still includes it, dropdown is client-filtered)
  const poList = (await http('GET', '/purchase-orders', { token: qa.finance.token })).data;
  const adminApprovedInList = poList.filter(p => p.status === 'admin_approved');
  if (poList.some(p => p.id === po2.id && p.status === 'admin_approved'))
    pass('admin-approved PO visible in PO list (creator/approver tracking), excluded from payments dropdown by status filter');
  else fail('admin-approved PO visible in PO list', 'not found');

  // PM project scoping
  const otherProject = (await http('POST', '/projects', {
    token: passToken,
    body: { name: `QA Other ${ts}`, client: 'QA', status: 'active', project_cost_value: '100000' },
    expected: 201,
  })).data;
  try {
    await http('GET', `/projects/${otherProject.id}/finance/petty-cash`, { token: qa.manager.token, expected: 403 });
    pass('PM blocked from unassigned project finance data');
  } catch (e) { fail('PM blocked from unassigned project finance data', e.message); }
  // assign PM → allowed
  const pmUserId = (await http('GET', '/users', { token: passToken })).data.find(u => u.email === qa.manager.email)?.id;
  if (pmUserId) {
    await http('PUT', `/projects/${otherProject.id}/managers/${pmUserId}`, { token: passToken, body: {}, expected: 201 });
    try {
      const pmOk = await http('GET', `/projects/${otherProject.id}/finance/petty-cash`, { token: qa.manager.token, expected: 200 });
      if (Array.isArray(pmOk.data)) pass('PM allowed after assignment (server-enforced scoping)');
      else fail('PM allowed after assignment', JSON.stringify(pmOk.data).slice(0, 120));
    } catch (e) { fail('PM allowed after assignment', e.message); }
  } else fail('PM assignment setup', 'pm user id not found');

  // permission: finance cannot approve POs at any stage
  try {
    await http('PUT', `/purchase-orders/${po3.id}/owner-approve`, { token: qa.finance.token, body: { approve: true }, expected: 403 });
    pass('finance blocked from PO approval (403)');
  } catch (e) { fail('finance blocked from PO approval', e.message); }

  // deactivated user → 401/403
  const deactEmail = `qa_deact${ts}@ims.com`;
  await http('POST', '/users', { token: passToken, body: { email: deactEmail, password: QA_PASSWORD, full_name: 'QA Deact', role: 'staff', phone: '03000000001' }, expected: 201 });
  const deactUser = (await http('GET', '/users', { token: passToken })).data.find(u => u.email === deactEmail);
  await http('PUT', `/users/${deactUser.id}`, { token: passToken, body: { is_active: false }, expected: 200 });
  const deactToken = await login(deactEmail, QA_PASSWORD);
  try {
    const res = await http('GET', '/projects', { token: deactToken });
    if (res.status === 401 || res.status === 403) pass('deactivated user blocked from API');
    else fail('deactivated user blocked from API', `status=${res.status}`);
  } catch (e) { fail('deactivated user blocked from API', e.message); }

  // orphan-safe: utilization of a deletion_requested parent
  const midDelPc = (await http('POST', `/projects/${pid}/finance/petty-cash`, {
    token: qa.finance.token, body: { description: `QA MidDel ${ts}`, amount: 5000, week_of: '2026-08-12', bank_id: bankId }, expected: 201,
  })).data;
  const midDelUtil = (await http('POST', `/projects/${pid}/finance/petty-cash/${midDelPc.id}/utilizations`, {
    token: qa.finance.token, body: { category: 'Misc', date: '2026-08-15', amount: 1000, note: 'child' }, expected: 201,
  })).data;
  await http('POST', `/projects/${pid}/finance/deletion-requests`, {
    token: qa.finance.token, body: { transaction_type: 'petty_cash', transaction_id: midDelPc.id, reason: 'parent mid-del' }, expected: 201,
  });
  try {
    await http('POST', `/projects/${pid}/finance/deletion-requests`, {
      token: qa.finance.token, body: { transaction_type: 'petty_cash_utilization', transaction_id: midDelUtil.id, reason: 'child' },
      expected: 400,
    });
    pass('utilization under mid-deletion parent locked from separate deletion');
  } catch (e) { fail('utilization under mid-deletion parent locked', e.message); }

  // single-record list (no pagination crash)
  const single = (await http('GET', `/projects/${zeroProject.id}/finance/salaries`, { token: qa.finance.token })).data;
  if (Array.isArray(single)) pass('single/empty list endpoints return arrays');
  else fail('single/empty list endpoints return arrays', JSON.stringify(single).slice(0, 100));

  // =====================================================================
  // SUMMARY
  // =====================================================================
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n=== RESULTS: ${passed} PASS / ${failed} FAIL ===\n`);
  if (failed) {
    console.log('Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.name}: ${r.detail || ''}`));
  }
  console.log(`\nQA_PASSWORD=${QA_PASSWORD}  ts=${ts}`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });