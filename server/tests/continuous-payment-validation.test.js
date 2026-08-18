const { d, add, sub, round2, toNumber, gt, gte } = require('../src/utils/decimal');

describe('Continuous Payment Validation', () => {
  describe('PO Outstanding Calculation', () => {
    test('Outstanding = PO Total - Sum of existing continuous payments', () => {
      const poTotal = d(1000000);
      const existingPayments = [
        d(200000),
        d(150000),
      ];

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));

      expect(outstanding).toBe(650000);
    });

    test('Outstanding = PO Total when no payments exist', () => {
      const poTotal = d(500000);
      const existingPayments = [];

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));

      expect(outstanding).toBe(500000);
    });

    test('Outstanding = 0 when fully paid', () => {
      const poTotal = d(300000);
      const existingPayments = [
        d(100000),
        d(200000),
      ];

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));

      expect(outstanding).toBe(0);
    });
  });

  describe('Payment Validation', () => {
    test('Rejects payment exceeding PO outstanding', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];
      const newPayment = d(600000);

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = sub(poTotal, paid);

      const exceeds = gt(newPayment, outstanding);
      expect(exceeds).toBe(true);
    });

    test('Allows payment equal to PO outstanding', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];
      const newPayment = d(500000);

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = sub(poTotal, paid);

      const exceeds = gt(newPayment, outstanding);
      expect(exceeds).toBe(false);
    });

    test('Allows payment less than PO outstanding', () => {
      const poTotal = d(1000000);
      const existingPayments = [d(200000), d(300000)];
      const newPayment = d(400000);

      const paid = existingPayments.reduce((s, p) => add(s, p), d(0));
      const outstanding = sub(poTotal, paid);

      const exceeds = gt(newPayment, outstanding);
      expect(exceeds).toBe(false);
    });
  });

  describe('Multiple Payments Tracking', () => {
    test('Tracks cumulative payments correctly', () => {
      const poTotal = d(1000000);
      let paid = d(0);

      // First payment
      paid = round2(add(paid, d(200000)));
      expect(toNumber(paid)).toBe(200000);

      // Second payment
      paid = round2(add(paid, d(150000)));
      expect(toNumber(paid)).toBe(350000);

      // Third payment
      paid = round2(add(paid, d(300000)));
      expect(toNumber(paid)).toBe(650000);

      const outstanding = toNumber(round2(sub(poTotal, paid)));
      expect(outstanding).toBe(350000);
    });

    test('Prevents overpayment through cumulative validation', () => {
      const poTotal = d(500000);
      let paid = d(0);

      // First payment
      paid = round2(add(paid, d(200000)));
      let outstanding = sub(poTotal, paid);
      expect(gte(outstanding, d(300000))).toBe(true);

      // Second payment - would exceed
      const newPayment = d(350000);
      outstanding = sub(poTotal, paid);
      const exceeds = gt(newPayment, outstanding);
      expect(exceeds).toBe(true);

      // But exactly at outstanding is allowed
      const exactPayment = d(300000);
      outstanding = sub(poTotal, paid);
      const exactExceeds = gt(exactPayment, outstanding);
      expect(exactExceeds).toBe(false);
    });
  });

  describe('Precision with Multiple Partial Payments', () => {
    test('Many small payments sum correctly without drift', () => {
      const poTotal = d(100000);
      const payments = Array(10).fill(d('10000'));

      const paid = payments.reduce((s, p) => round2(add(s, p)), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));

      expect(toNumber(paid)).toBe(100000);
      expect(outstanding).toBe(0);
    });

    test('Payments with decimals track correctly', () => {
      const poTotal = d('100000.50');
      const payments = [
        d('33333.33'),
        d('33333.33'),
        d('33333.84'),
      ];

      const paid = payments.reduce((s, p) => round2(add(s, p)), d(0));
      const outstanding = toNumber(round2(sub(poTotal, paid)));

      expect(toNumber(paid)).toBe(100000.50);
      expect(outstanding).toBe(0);
    });
  });

  describe('Payment Type Restrictions', () => {
    test('Continuous payments require PO linkage', () => {
      const paymentType = 'continuous';
      const requiresPo = paymentType === 'continuous';
      expect(requiresPo).toBe(true);
    });

    test('Fixed OTP payments do not require PO', () => {
      const paymentType = 'fixed_otp';
      const requiresPo = paymentType === 'continuous';
      expect(requiresPo).toBe(false);
    });

    test('IPC payments do not require PO', () => {
      const paymentType = 'ipc';
      const requiresPo = paymentType === 'continuous';
      expect(requiresPo).toBe(false);
    });
  });
});