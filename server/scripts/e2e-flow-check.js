/**
 * END-TO-END HAPPY-PATH FLOW (single project timeline)
 * The complete chain: PO (Procurement) -> Admin approve -> Owner approve ->
 * Continuous vendor payment -> Petty cash disbursement -> Utilization split ->
 * Utilization deletion request (2-step) -> balances + P/L recheck.
 */
const root = 'C:/Users/Umer/Desktop/IMS/IMS-Construction';
require(root + '/server/node_modules/dotenv').config({ path: root + '/server/.env' });

const ORIGIN = process.argv[2] || 'https://ims-construction.vercel.app';
const PASSWORD = process.argv[3] || 'Qa!Set2026x9';
const API = `${ORIGIN}/api`;
const ts = Date.now();
const steps = [];
const step = (s) => { steps.push(s); console.log(`  ${steps.length}. ${s}`); };
let exitCode = 0;

async function http(method, urlPath, { token, body, expected } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${urlPath}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
  if (expected && res.status !== expected)
    throw new Error(`${method} ${urlPath} -> ${res.status} (want ${expected}): ${String(t).slice(0, 200)}`);
  return { status: res.status, data };
}
const login = async (e, p) => (await http('POST', '/auth/login', { body: { email: e, password: p } })).data.token;

(async () => {
  console.log(`\n=== END-TO-END FLOW — ${ORIGIN} (ts=${ts}) ===`);
  const admin = await login('admin@ims.com', PASSWORD);
  const owner = await login('owner@ims.com', PASSWORD);

  // 1. fixture
  const project = (await http('POST', '/projects', { token: admin, body: { name: `QA E2E ${ts}`, client: 'QA', status: 'active', project_cost_value: '5000000' }, expected: 201 })).data;
  const vendor = (await http('POST', '/vendors', { token: admin, body: { name: `QA E2E Vendor ${ts}`, phone: '03000000000', status: 'active' }, expected: 201 })).data;
  const pcUser = await login(('qa_finance' + ts) != '' ? 'finance@ims.com' : '', PASSWORD);
  const banks = (await http('GET', '/banks', { token: pcUser })).data;
  const bankId = banks[0].id;
  const procurement = await login('procurement@ims.com', PASSWORD);
  step(`fixtures created (project ${project.name}, vendor, bank ${banks[0].name})`);

  // 2. PO created by Procurement with Site
  const po = (await http('POST', `/vendors/${vendor.id}/purchase-orders`, { token: procurement, body: { project_id: project.id, items: [{ material_name: 'Steel', quantity: 20, unit: 'ton', unit_price: 150000 }] }, expected: 201 })).data;
  step(`PO ${po.po_number} created by Procurement (status=${po.status})`);

  // 3. sequential approvals
  const a1 = (await http('PUT', `/purchase-orders/${po.id}/admin-approve`, { token: admin, body: { approve: true }, expected: 200 })).data;
  if (a1.status !== 'admin_approved') throw new Error('step3a');
  step(`Admin approval -> ${a1.status}`);
  const a2 = (await http('PUT', `/purchase-orders/${po.id}/owner-approve`, { token: owner, body: { approve: true }, expected: 200 })).data;
  if (a2.status !== 'approved') throw new Error('step3b');
  step(`Owner approval -> ${a2.status} (fully approved)`);

  // 4. continuous payment linked to the PO
  const vp = (await http('POST', `/projects/${project.id}/finance/vendor-payments`, { token: pcUser, body: { vendor_id: vendor.id, payment_type: 'continuous', amount: 3000000, po_id: po.id, payment_date: '2026-08-15', bank_id: bankId }, expected: 201 })).data;
  step(`Continuous payment PKR 3,000,000 linked to ${vp.po_number} (bank debit)`);

  // 5. petty cash disbursement
  const pc = (await http('POST', `/projects/${project.id}/finance/petty-cash`, { token: pcUser, body: { description: `E2E kit ${ts}`, amount: 50000, week_of: '2026-08-15', bank_id: bankId }, expected: 201 })).data;
  step(`Petty cash disbursed PKR 50,000`);

  // 6. utilization split 20k / 30k
  await http('POST', `/projects/${project.id}/finance/petty-cash/${pc.id}/utilizations`, { token: pcUser, body: { category: 'Material', date: '2026-08-15', amount: 20000, note: 'cement order', receipt_ref: 'R-E2E-1' }, expected: 201 });
  await http('POST', `/projects/${project.id}/finance/petty-cash/${pc.id}/utilizations`, { token: pcUser, body: { category: 'Labor', date: '2026-08-16', amount: 30000, note: 'site labour', receipt_ref: 'R-E2E-2' }, expected: 201 });
  step(`Utilization recorded: Material 20,000 + Labor 30,000 (remaining 0)`);

  // 7. deletion of the labor entry (2-step), balance restored
  const victim = (await http('GET', `/projects/${project.id}/finance/petty-cash/${pc.id}/utilizations`, { token: pcUser })).data.entries.find(e => e.note === 'site labour');
  const dr = (await http('POST', `/projects/${project.id}/finance/deletion-requests`, { token: pcUser, body: { transaction_type: 'petty_cash_utilization', transaction_id: victim.id, reason: 'E2E rollback' }, expected: 201 })).data;
  step(`Deletion request created for the PKR 30,000 labor utilization`);
  await http('PATCH', `/projects/${project.id}/finance/deletion-requests/${dr.id}/admin-approve`, { token: admin, body: { approve: true }, expected: 200 });
  const drDone = (await http('PATCH', `/projects/${project.id}/finance/deletion-requests/${dr.id}/owner-approve`, { token: owner, body: { approve: true }, expected: 200 })).data;
  if (drDone.final_status !== 'approved') throw new Error('step7');
  step(`Deletion approved by Admin + Owner -> final_status=${drDone.final_status}`);

  // 8. final accounting
  const s = (await http('GET', `/projects/${project.id}/finance/summary`, { token: pcUser })).data;
  const expectedUtilized = 20000;            // only the material entry survived
  const expectedCost = 3000000 + 20000;      // vendor payment + utilized petty cash
  const profit = parseFloat(s.project_cost_value) - parseFloat(s.actual_cost);
  console.log('\n  FINAL LEDGER:');
  console.log(`    amount_received       : ${s.amount_received_total}`);
  console.log(`    vendor_payments_total : ${s.vendor_payments_total}`);
  console.log(`    petty_cash_disbursed  : ${s.petty_cash_total}`);
  console.log(`    petty_cash_utilized   : ${s.petty_cash_utilized_total}`);
  console.log(`    petty_cash_remaining  : ${s.petty_cash_remaining}`);
  console.log(`    actual_cost           : ${s.actual_cost}`);
  console.log(`    profit_loss           : ${s.profit_loss}`);
  const checks = [
    ['vendor payments = 3,000,000', Math.abs(parseFloat(s.vendor_payments_total) - 3000000) < 0.01],
    ['petty cash utilized = 20,000 after deletion', Math.abs(parseFloat(s.petty_cash_utilized_total) - expectedUtilized) < 0.01],
    ['petty cash remaining = 30,000 restored', Math.abs(parseFloat(s.petty_cash_remaining) - 30000) < 0.01],
    ['actual cost = 3,020,000', Math.abs(parseFloat(s.actual_cost) - expectedCost) < 0.01],
    ['profit_loss = 5,000,000 - 3,020,000', Math.abs(parseFloat(s.profit_loss) - (5000000 - expectedCost)) < 0.01],
  ];
  console.log('');
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '[PASS]' : '[FAIL]'} ${name}`);
    if (!ok) exitCode = 1;
  }
  console.log(`\nE2E FLOW: ${exitCode === 0 ? 'ALL CHECKS PASS' : 'FAILED'} (${steps.length} steps)`);
  process.exit(exitCode);
})().catch(e => { console.error('E2E FATAL:', e.message); process.exit(1); });