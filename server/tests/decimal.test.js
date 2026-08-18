const { d, add, sub, mul, div, round2, toNumber, toFixed, eq, gt, gte, lt, lte } = require('../src/utils/decimal');

describe('decimal.js utility', () => {
  describe('d() - Decimal constructor', () => {
    test('creates Decimal from number', () => {
      expect(d(5).toNumber()).toBe(5);
    });

    test('creates Decimal from string', () => {
      expect(d('5.25').toNumber()).toBe(5.25);
    });

    test('handles null/undefined/empty string as 0', () => {
      expect(d(null).toNumber()).toBe(0);
      expect(d(undefined).toNumber()).toBe(0);
      expect(d('').toNumber()).toBe(0);
    });

    test('handles negative numbers', () => {
      expect(d(-10).toNumber()).toBe(-10);
    });
  });

  describe('add()', () => {
    test('adds two positive numbers', () => {
      expect(toNumber(add(d(1), d(2)))).toBe(3);
    });

    test('adds decimals without floating point error', () => {
      // Classic 0.1 + 0.2 = 0.30000000000000004 problem
      expect(toNumber(add(d('0.1'), d('0.2')))).toBe(0.3);
    });

    test('adds negative numbers', () => {
      expect(toNumber(add(d(-5), d(-3)))).toBe(-8);
    });

    test('adds mixed positive and negative', () => {
      expect(toNumber(add(d(10), d(-3)))).toBe(7);
    });
  });

  describe('sub()', () => {
    test('subtracts two positive numbers', () => {
      expect(toNumber(sub(d(5), d(3)))).toBe(2);
    });

    test('subtracts decimals without floating point error', () => {
      expect(toNumber(sub(d('0.3'), d('0.1')))).toBe(0.2);
    });

    test('handles negative result', () => {
      expect(toNumber(sub(d(3), d(5)))).toBe(-2);
    });
  });

  describe('mul()', () => {
    test('multiplies two numbers', () => {
      expect(toNumber(mul(d(3), d(4)))).toBe(12);
    });

    test('multiplies decimals', () => {
      expect(toNumber(mul(d('0.5'), d('0.5')))).toBe(0.25);
    });

    test('handles percentage calculation', () => {
      // 50% of 1000
      expect(toNumber(mul(d('0.5'), d(1000)))).toBe(500);
    });
  });

  describe('div()', () => {
    test('divides two numbers', () => {
      expect(toNumber(div(d(10), d(2)))).toBe(5);
    });

    test('divides decimals', () => {
      expect(toNumber(div(d('0.3'), d('0.1')))).toBe(3);
    });

    test('handles percentage rate calculation', () => {
      // 500 / 1000 = 0.5 (50%)
      expect(toNumber(div(d(500), d(1000)))).toBe(0.5);
    });
  });

  describe('round2()', () => {
    test('rounds to 2 decimal places', () => {
      expect(toNumber(round2(d('1.234')))).toBe(1.23);
      expect(toNumber(round2(d('1.235')))).toBe(1.24);
      expect(toNumber(round2(d('1.236')))).toBe(1.24);
    });

    test('handles whole numbers', () => {
      expect(toNumber(round2(d(5)))).toBe(5);
    });

    test('handles numbers with 1 decimal place', () => {
      expect(toNumber(round2(d('1.5')))).toBe(1.5);
    });
  });

  describe('toNumber()', () => {
    test('converts Decimal to number', () => {
      expect(toNumber(d('123.45'))).toBe(123.45);
    });

    test('rounds to 2 decimal places', () => {
      expect(toNumber(d('1.234'))).toBe(1.23);
    });
  });

  describe('toFixed()', () => {
    test('returns string with fixed decimal places', () => {
      expect(toFixed(d('1.5'))).toBe('1.50');
      expect(toFixed(d('1'))).toBe('1.00');
    });

    test('accepts custom decimal places', () => {
      expect(toFixed(d('1.5'), 3)).toBe('1.500');
    });
  });

  describe('eq()', () => {
    test('returns true for equal numbers', () => {
      expect(eq(d(5), d(5))).toBe(true);
    });

    test('returns false for unequal numbers', () => {
      expect(eq(d(5), d(3))).toBe(false);
    });

    test('handles decimal equality', () => {
      expect(eq(d('0.1'), add(d('0.1'), d(0)))).toBe(true);
    });
  });

  describe('gt()', () => {
    test('returns true when first is greater', () => {
      expect(gt(d(5), d(3))).toBe(true);
    });

    test('returns false when first is not greater', () => {
      expect(gt(d(3), d(5))).toBe(false);
      expect(gt(d(5), d(5))).toBe(false);
    });
  });

  describe('gte()', () => {
    test('returns true when first is greater or equal', () => {
      expect(gte(d(5), d(3))).toBe(true);
      expect(gte(d(5), d(5))).toBe(true);
    });

    test('returns false when first is less', () => {
      expect(gte(d(3), d(5))).toBe(false);
    });
  });

  describe('lt()', () => {
    test('returns true when first is less', () => {
      expect(lt(d(3), d(5))).toBe(true);
    });

    test('returns false when first is not less', () => {
      expect(lt(d(5), d(3))).toBe(false);
      expect(lt(d(5), d(5))).toBe(false);
    });
  });

  describe('lte()', () => {
    test('returns true when first is less or equal', () => {
      expect(lte(d(3), d(5))).toBe(true);
      expect(lte(d(5), d(5))).toBe(true);
    });

    test('returns false when first is greater', () => {
      expect(lte(d(5), d(3))).toBe(false);
    });
  });

  describe('Floating point precision tests', () => {
    test('0.1 + 0.2 = 0.3 exactly', () => {
      const result = add(d('0.1'), d('0.2'));
      expect(toNumber(result)).toBe(0.3);
      expect(eq(result, d('0.3'))).toBe(true);
    });

    test('Multiple additions do not accumulate error', () => {
      let sum = d(0);
      for (let i = 0; i < 10; i++) {
        sum = add(sum, d('0.1'));
      }
      expect(toNumber(sum)).toBe(1.0);
    });

    test('Subtraction preserves precision', () => {
      const result = sub(d('1.0'), d('0.1'));
      expect(toNumber(result)).toBe(0.9);
    });

    test('Percentage calculation: 33.33% of 1000', () => {
      const percent = div(d('33.33'), d('100'));
      const result = mul(percent, d(1000));
      expect(toNumber(round2(result))).toBe(333.3);
    });
  });
});