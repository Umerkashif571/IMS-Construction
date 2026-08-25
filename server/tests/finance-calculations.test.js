const { d, add, sub, mul, div, round2, toNumber, toFixed, gt, gte, eq, lte } = require('../src/utils/decimal');

describe('Finance Calculations', () => {
  describe('Summary Calculations', () => {
    test('actualCost = salaries + pettyCashReceivedOnsite + vendorPayments + materialCost (when full access)', () => {
      const salariesTotal = d(100000);
      const pettyCashReceivedOnsite = d(25000);
      const vendorPaymentsTotal = d(500000);
      const materialCostTotal = d(75000);
      const vendorIncluded = true;

      const actualCost = toNumber(
        add(
          add(add(d(salariesTotal), d(pettyCashReceivedOnsite)), d(materialCostTotal)),
          vendorIncluded ? vendorPaymentsTotal : d(0)
        )
      );
      expect(actualCost).toBe(700000);
    });

    test('actualCost = salaries + pettyCashReceivedOnsite + materialCost (when PM access, no vendor)', () => {
      const salariesTotal = d(100000);
      const pettyCashReceivedOnsite = d(25000);
      const materialCostTotal = d(75000);
      const vendorPaymentsTotal = d(500000);
      const vendorIncluded = false;

      const actualCost = toNumber(
        add(
          add(add(d(salariesTotal), d(pettyCashReceivedOnsite)), d(materialCostTotal)),
          vendorIncluded ? vendorPaymentsTotal : d(0)
        )
      );
      expect(actualCost).toBe(200000);
    });

    test('profitLoss = projectCostValue - actualCost', () => {
      const projectCostValue = d(1000000);
      const actualCost = d(700000);

      const profitLoss = toNumber(sub(projectCostValue, actualCost));
      expect(profitLoss).toBe(300000);
    });

    test('balanceReceived = amountReceivedTotal - actualCost', () => {
      const amountReceivedTotal = d(800000);
      const actualCost = d(700000);

      const balanceReceived = toNumber(sub(amountReceivedTotal, actualCost));
      expect(balanceReceived).toBe(100000);
    });

    test('percentUtilized = (actualCost / projectCostValue) * 100', () => {
      const actualCost = d(700000);
      const projectCostValue = d(1000000);

      const percentUtilized = toNumber(round2(mul(div(actualCost, projectCostValue), d(100))));
      expect(percentUtilized).toBe(70.0);
    });

    test('percentUtilized = 0 when projectCostValue is 0', () => {
      const actualCost = d(100000);
      const projectCostValue = d(0);

      const percentUtilized = projectCostValue.gt(0) ? toNumber(round2(mul(div(actualCost, projectCostValue), d(100)))) : 0;
      expect(percentUtilized).toBe(0);
    });
  });

  describe('Petty Cash Calculations', () => {
    test('pettyCashRemaining = pettyCashTotal - pettyCashUtilized', () => {
      const pettyCashTotal = d(50000);
      const pettyCashUtilized = d(32150.75);

      const remaining = toNumber(round2(sub(pettyCashTotal, pettyCashUtilized)));
      expect(remaining).toBe(17849.25);
    });

    test('pettyCashRemaining never negative (floored at 0)', () => {
      const pettyCashTotal = d(10000);
      const pettyCashUtilized = d(15000);

      const remaining = Math.max(0, toNumber(round2(sub(pettyCashTotal, pettyCashUtilized))));
      expect(remaining).toBe(0);
    });

    test('pettyCashUtilizationRate = (utilized / total) * 100', () => {
      const pettyCashTotal = d(50000);
      const pettyCashUtilized = d(32150);

      const rate = toNumber(round2(mul(div(pettyCashUtilized, pettyCashTotal), d(100))));
      expect(rate).toBe(64.3);
    });

    test('pettyCashUtilizationRate = 0 when total is 0', () => {
      const pettyCashTotal = d(0);
      const pettyCashUtilized = d(0);

      const rate = pettyCashTotal.gt(0) ? toNumber(round2(mul(div(pettyCashUtilized, pettyCashTotal), d(100)))) : 0;
      expect(rate).toBe(0);
    });

    test('Multiple partial utilizations sum exactly to disbursed', () => {
      const disbursed = d(100000);
      const utilizations = [
        d('33333.33'),
        d('33333.33'),
        d('33333.34'),
      ];

      const sum = utilizations.reduce((s, u) => add(s, u), d(0));
      expect(toNumber(sum)).toBe(100000);
      expect(eq(sum, disbursed)).toBe(true);
    });

    test('pettyCashReceivedOnsite equals disbursed amount', () => {
      const pettyCashTotal = d(50000);
      const pettyCashReceivedOnsite = pettyCashTotal; // amount field = disbursed/received onsite
      expect(pettyCashReceivedOnsite).toEqual(pettyCashTotal);
    });
  });

  describe('Vendor Payment Totals', () => {
    test('Continuous payments sum correctly across multiple payments', () => {
      const payments = [
        d(100000),
        d(150000),
        d(250000),
      ];

      const total = payments.reduce((s, p) => add(s, p), d(0));
      expect(toNumber(total)).toBe(500000);
    });

    test('PO outstanding = PO total - sum of continuous payments', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));
      expect(outstanding).toBe(500000);
    });

    test('New continuous payment cannot exceed PO outstanding', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];
      const newPayment = d(600000);

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = sub(poTotal, paid);

      expect(gt(newPayment, outstanding)).toBe(true);
    });

    test('New continuous payment within PO outstanding is allowed', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];
      const newPayment = d(400000);

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = sub(poTotal, paid);

      expect(gte(outstanding, newPayment)).toBe(true);
    });
  });

  describe('IPC Percentage Validation', () => {
    test('IPC percentage must be between 0 and 100', () => {
      const validPct = d(50);
      const invalidNegative = d(-10);
      const invalidOver100 = d(150);

      expect(gte(validPct, d(0)) && lte(validPct, d(100))).toBe(true);
      expect(gte(invalidNegative, d(0)) && lte(invalidNegative, d(100))).toBe(false);
      expect(gte(invalidOver100, d(0)) && lte(invalidOver100, d(100))).toBe(false);
    });

    test('IPC percentage stored as decimal with 2 places', () => {
      const pct = d('33.33');
      expect(toFixed(pct, 2)).toBe('33.33');
    });
  });

  describe('Amount Received', () => {
    test('Multiple receipts sum correctly', () => {
      const receipts = [
        d(500000),
        d(300000),
        d(200000),
      ];

      const total = receipts.reduce((s, r) => add(s, r), d(0));
      expect(toNumber(total)).toBe(1000000);
    });
  });

  describe('Material Cost Calculations', () => {
    test('materialCost = sum of (quantity * unit_cost) for material_transactions type=out', () => {
      const transactions = [
        { quantity: d(100), unit_cost: d(500) }, // 50000
        { quantity: d(50), unit_cost: d(1000) }, // 50000
        { quantity: d(200), unit_cost: d(250) }, // 50000
      ];

      const total = transactions.reduce((s, t) => add(s, mul(t.quantity, t.unit_cost)), d(0));
      expect(toNumber(total)).toBe(150000);
    });

    test('materialCost excludes type=in transactions', () => {
      const transactions = [
        { type: 'out', quantity: d(100), unit_cost: d(500) }, // 50000
        { type: 'in', quantity: d(50), unit_cost: d(1000) }, // 50000 (should be excluded)
      ];

      const total = transactions
        .filter(t => t.type === 'out')
        .reduce((s, t) => add(s, mul(t.quantity, t.unit_cost)), d(0));
      expect(toNumber(total)).toBe(50000);
    });
  });
});