const { d, add, sub, round2, toNumber, gt, eq } = require('../src/utils/decimal');

describe('Bank Book Running Balance', () => {
  describe('Running Balance Calculations', () => {
    test('Running balance with classic 0.1 + 0.2 floating point case', () => {
      const transactions = [
        { amount_in: d('0.1'), amount_out: d('0') },
        { amount_in: d('0.2'), amount_out: d('0') },
        { amount_in: d('0.3'), amount_out: d('0') },
      ];

      let running = d(0);
      const balances = transactions.map(t => {
        running = round2(add(sub(running, t.amount_out), t.amount_in));
        return toNumber(running);
      });

      expect(balances).toEqual([0.1, 0.3, 0.6]);
    });

    test('Running balance with mixed in/out transactions', () => {
      const transactions = [
        { amount_in: d('100000'), amount_out: d('0') },      // Deposit
        { amount_in: d('0'), amount_out: d('25000') },       // Withdrawal
        { amount_in: d('50000'), amount_out: d('0') },       // Deposit
        { amount_in: d('0'), amount_out: d('10000') },       // Withdrawal
      ];

      let running = d(0);
      const balances = transactions.map(t => {
        running = round2(add(sub(running, t.amount_out), t.amount_in));
        return toNumber(running);
      });

      expect(balances).toEqual([100000, 75000, 125000, 115000]);
    });

    test('Running balance ignores deleted transactions', () => {
      const transactions = [
        { amount_in: d('100000'), amount_out: d('0'), status: 'active' },
        { amount_in: d('50000'), amount_out: d('0'), status: 'deleted' },  // Should be ignored
        { amount_in: d('0'), amount_out: d('25000'), status: 'active' },
      ];

      let running = d(0);
      const balances = transactions
        .filter(t => t.status !== 'deleted')
        .map(t => {
          running = round2(add(sub(running, t.amount_out), t.amount_in));
          return toNumber(running);
        });

      expect(balances).toEqual([100000, 75000]);
    });

    test('Closing balance = Total In - Total Out', () => {
      const transactions = [
        { amount_in: d('100000'), amount_out: d('0') },
        { amount_in: d('50000'), amount_out: d('0') },
        { amount_in: d('0'), amount_out: d('30000') },
        { amount_in: d('0'), amount_out: d('20000') },
      ];

      const totalIn = transactions.reduce((s, t) => add(s, t.amount_in), d(0));
      const totalOut = transactions.reduce((s, t) => add(s, t.amount_out), d(0));
      const closing = toNumber(sub(totalIn, totalOut));

      expect(toNumber(totalIn)).toBe(150000);
      expect(toNumber(totalOut)).toBe(50000);
      expect(closing).toBe(100000);
    });
  });

  describe('Chronological Ordering', () => {
    test('Balance computed in date order, not insertion order', () => {
      // Transactions out of chronological order
      const transactions = [
        { date: '2024-01-03', amount_in: d('0'), amount_out: d('10000') },
        { date: '2024-01-01', amount_in: d('50000'), amount_out: d('0') },
        { date: '2024-01-02', amount_in: d('0'), amount_out: d('5000') },
      ];

      // Sort by date first
      const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

      let running = d(0);
      const balances = sorted.map(t => {
        running = round2(add(sub(running, t.amount_out), t.amount_in));
        return toNumber(running);
      });

      // Balance should be: 50000 -> 45000 -> 35000
      expect(balances).toEqual([50000, 45000, 35000]);
    });
  });

  describe('Manual vs Auto Transactions', () => {
    test('Both manual and auto transactions included in balance', () => {
      const transactions = [
        { amount_in: d('100000'), amount_out: d('0'), source_type: 'manual' },
        { amount_in: d('50000'), amount_out: d('0'), source_type: 'amount_received' },
        { amount_in: d('0'), amount_out: d('25000'), source_type: 'salary' },
        { amount_in: d('0'), amount_out: d('15000'), source_type: 'vendor_payment' },
      ];

      const totalIn = transactions.reduce((s, t) => add(s, t.amount_in), d(0));
      const totalOut = transactions.reduce((s, t) => add(s, t.amount_out), d(0));
      const balance = toNumber(sub(totalIn, totalOut));

      expect(balance).toBe(110000);
    });
  });

  describe('Precision Edge Cases', () => {
    test('Many small transactions do not accumulate error', () => {
      const transactions = Array(100).fill(null).map(() => ({
        amount_in: d('100.01'),
        amount_out: d('0'),
      }));

      let running = d(0);
      transactions.forEach(t => {
        running = round2(add(sub(running, t.amount_out), t.amount_in));
      });

      expect(toNumber(running)).toBe(10001);
    });

    test('Balance remains consistent after many operations', () => {
      let running = d('100000');
      
      // 50 deposits of 100.01
      for (let i = 0; i < 50; i++) {
        running = round2(add(running, d('100.01')));
      }
      
      // 30 withdrawals of 50.02
      for (let i = 0; i < 30; i++) {
        running = round2(sub(running, d('50.02')));
      }
      
      // Expected: 100000 + 5000.50 - 1500.60 = 103500 - wait, let's compute precisely
      // 100000 + (50 * 100.01) - (30 * 50.02) = 100000 + 5000.50 - 1500.60 = 103500 - 1500.60 = 103499.90
      expect(toNumber(running)).toBe(103499.90);
    });
  });
});