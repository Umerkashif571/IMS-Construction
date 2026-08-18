const { d, add, sub, round2, toNumber, gt } = require('../src/utils/decimal');

describe('Petty Cash Utilization', () => {
  describe('Running Balance Calculations', () => {
    test('Running balance accumulates correctly across multiple utilizations', () => {
      const disbursed = d(100000);
      const utilizations = [
        { amount: d('30000'), category: 'Material' },
        { amount: d('25000'), category: 'Labor' },
        { amount: d('20000'), category: 'Transport' },
      ];

      let running = d(0);
      const balances = utilizations.map(u => {
        running = round2(add(running, u.amount));
        return toNumber(round2(sub(disbursed, running)));
      });

      expect(balances).toEqual([70000, 45000, 25000]);
    });

    test('Running balance never drifts due to floating point', () => {
      // This would fail with raw float: 0.1 + 0.2 + 0.3 + 0.4 = 1.0000000000000001
      const disbursed = d(100000);
      const utilizations = [
        d('33333.33'),
        d('33333.33'),
        d('33333.34'),
      ];

      let running = d(0);
      utilizations.forEach(u => {
        running = round2(add(running, u));
      });

      expect(toNumber(running)).toBe(100000);
      expect(toNumber(round2(sub(disbursed, running)))).toBe(0);
    });

    test('Final utilization exactly equals disbursed leaves 0 remaining', () => {
      const disbursed = d(50000);
      const utilizations = [d(20000), d(15000), d(15000)];

      let running = d(0);
      utilizations.forEach(u => {
        running = round2(add(running, u));
      });

      const remaining = toNumber(round2(sub(disbursed, running)));
      expect(remaining).toBe(0);
    });
  });

  describe('Overspend Prevention', () => {
    test('Detects overspend when total utilized exceeds disbursed', () => {
      const disbursed = d(50000);
      const existingUtilized = d(40000);
      const newUtilization = d(15000);

      const wouldExceed = gt(add(existingUtilized, newUtilization), disbursed);
      expect(wouldExceed).toBe(true);
    });

    test('Allows utilization when within disbursed amount', () => {
      const disbursed = d(50000);
      const existingUtilized = d(40000);
      const newUtilization = d(5000);

      const wouldExceed = gt(add(existingUtilized, newUtilization), disbursed);
      expect(wouldExceed).toBe(false);
    });

    test('Allows utilization when exactly equals disbursed', () => {
      const disbursed = d(50000);
      const existingUtilized = d(40000);
      const newUtilization = d(10000);

      const wouldExceed = gt(add(existingUtilized, newUtilization), disbursed);
      expect(wouldExceed).toBe(false);
    });
  });

  describe('Utilization Categories', () => {
    test('Categories are properly tracked', () => {
      const utilizations = [
        { amount: d('30000'), category: 'Material' },
        { amount: d('20000'), category: 'Labor' },
        { amount: d('10000'), category: 'Transport' },
      ];

      const byCategory = utilizations.reduce((acc, u) => {
        if (!acc[u.category]) acc[u.category] = d(0);
        acc[u.category] = add(acc[u.category], u.amount);
        return acc;
      }, {});

      expect(toNumber(byCategory.Material)).toBe(30000);
      expect(toNumber(byCategory.Labor)).toBe(20000);
      expect(toNumber(byCategory.Transport)).toBe(10000);
    });
  });

  describe('Partial Utilization Sums', () => {
    test('Multiple small utilizations sum correctly', () => {
      const utilizations = Array(10).fill(d('0.01'));
      const sum = utilizations.reduce((s, u) => add(s, u), d(0));
      expect(toNumber(sum)).toBe(0.10);
    });

    test('Large number of utilizations do not accumulate floating point error', () => {
      // 100 utilizations of 1000.01 = 100001
      const utilizations = Array(100).fill(d('1000.01'));
      const sum = utilizations.reduce((s, u) => round2(add(s, u)), d(0));
      expect(toNumber(sum)).toBe(100001);
    });
  });
});