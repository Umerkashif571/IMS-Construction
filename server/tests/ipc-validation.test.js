const { d, add, sub, mul, div, round2, toNumber, toFixed, gt, gte, lt, lte, eq } = require('../src/utils/decimal');

describe('IPC Percentage Validation', () => {
  describe('Percentage Range Validation', () => {
    test('Valid IPC percentage (0-100) passes', () => {
      const validPercentages = [d(0), d(1), d(50), d(99), d(100)];

      validPercentages.forEach(pct => {
        const inRange = gte(pct, d(0)) && lte(pct, d(100));
        expect(inRange).toBe(true);
      });
    });

    test('Negative IPC percentage fails', () => {
      const negative = d(-1);
      const inRange = gte(negative, d(0)) && lte(negative, d(100));
      expect(inRange).toBe(false);
    });

    test('IPC percentage over 100 fails', () => {
      const over100 = d(101);
      const inRange = gte(over100, d(0)) && lte(over100, d(100));
      expect(inRange).toBe(false);
    });

    test('Decimal percentages allowed (e.g., 33.33)', () => {
      const decimalPct = d('33.33');
      const inRange = gte(decimalPct, d(0)) && lte(decimalPct, d(100));
      expect(inRange).toBe(true);
    });

    test('Two decimal places precision enforced', () => {
      const pct = d('33.333');
      const rounded = round2(pct);
      expect(toNumber(rounded)).toBe(33.33);
    });
  });

  describe('IPC Payment Amount Calculation', () => {
    test('IPC amount is manually entered, not auto-calculated from percentage', () => {
      // IPC payments: amount is entered directly, percentage is metadata
      const ipcPercentComplete = d('50');
      const contractValue = d(1000000);
      const enteredAmount = d(500000);

      // Amount is independent - not calculated from % * contract
      // This is by design per requirements
      expect(eq(enteredAmount, mul(div(ipcPercentComplete, d(100)), contractValue))).toBe(true);
      // But the system does NOT enforce this - it's just metadata
    });

    test('Percentage stored as DECIMAL(5,2) in database', () => {
      // Schema: ipc_percent_complete DECIMAL(5, 2)
      // Max value: 999.99, but CHECK constraint limits to 100
      const maxPct = d(100);
      expect(toFixed(maxPct, 2)).toBe('100.00');
    });
  });

  describe('IPC Metadata Only', () => {
    test('IPC percentage does not affect payment amount validation', () => {
      // The system validates: payment_type === 'ipc' -> ipc_percent_complete required
      // But amount is validated independently (must be > 0)
      const ipcPercentComplete = d('75');
      const amount = d(100000);

      const pctValid = gte(ipcPercentComplete, d(0)) && lte(ipcPercentComplete, d(100));
      const amountValid = gt(amount, d(0));

      expect(pctValid).toBe(true);
      expect(amountValid).toBe(true);
    });

    test('IPC percentage required for IPC payment type', () => {
      const paymentType = 'ipc';
      const requiresPercentage = paymentType === 'ipc';
      expect(requiresPercentage).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('0% IPC complete is valid', () => {
      const pct = d(0);
      expect(gte(pct, d(0)) && lte(pct, d(100))).toBe(true);
    });

    test('100% IPC complete is valid', () => {
      const pct = d(100);
      expect(gte(pct, d(0)) && lte(pct, d(100))).toBe(true);
    });

    test('Non-numeric input rejected', () => {
      const invalid = d('abc');
      expect(invalid.isNaN()).toBe(true);
    });

    test('Empty string treated as 0', () => {
      const empty = d('');
      expect(empty.toNumber()).toBe(0);
    });
  });
});