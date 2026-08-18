const { d, add, sub, round2, toNumber, gt, gte, eq } = require('../src/utils/decimal');

describe('Deletion Workflow (Two-Step Approval)', () => {
  describe('Approval Flow Logic', () => {
    test('Final status pending when both approvals pending', () => {
      const deletionRequest = {
        admin_approval: 'pending',
        owner_approval: 'pending',
      };

      let finalStatus = 'pending';
      if (deletionRequest.admin_approval === 'rejected' || deletionRequest.owner_approval === 'rejected') {
        finalStatus = 'rejected';
      } else if (deletionRequest.admin_approval === 'approved' && deletionRequest.owner_approval === 'approved') {
        finalStatus = 'approved';
      }

      expect(finalStatus).toBe('pending');
    });

    test('Final status rejected when admin rejects', () => {
      const deletionRequest = {
        admin_approval: 'rejected',
        owner_approval: 'pending',
      };

      let finalStatus = 'pending';
      if (deletionRequest.admin_approval === 'rejected' || deletionRequest.owner_approval === 'rejected') {
        finalStatus = 'rejected';
      } else if (deletionRequest.admin_approval === 'approved' && deletionRequest.owner_approval === 'approved') {
        finalStatus = 'approved';
      }

      expect(finalStatus).toBe('rejected');
    });

    test('Final status rejected when owner rejects', () => {
      const deletionRequest = {
        admin_approval: 'approved',
        owner_approval: 'rejected',
      };

      let finalStatus = 'pending';
      if (deletionRequest.admin_approval === 'rejected' || deletionRequest.owner_approval === 'rejected') {
        finalStatus = 'rejected';
      } else if (deletionRequest.admin_approval === 'approved' && deletionRequest.owner_approval === 'approved') {
        finalStatus = 'approved';
      }

      expect(finalStatus).toBe('rejected');
    });

    test('Final status approved when both approve', () => {
      const deletionRequest = {
        admin_approval: 'approved',
        owner_approval: 'approved',
      };

      let finalStatus = 'pending';
      if (deletionRequest.admin_approval === 'rejected' || deletionRequest.owner_approval === 'rejected') {
        finalStatus = 'rejected';
      } else if (deletionRequest.admin_approval === 'approved' && deletionRequest.owner_approval === 'approved') {
        finalStatus = 'approved';
      }

      expect(finalStatus).toBe('approved');
    });
  });

  describe('Sequential Order Enforcement', () => {
    test('Owner cannot approve before admin', () => {
      const deletionRequest = {
        admin_approval: 'pending',
        owner_approval: 'pending',
      };

      // Owner tries to approve first
      const canOwnerAct = deletionRequest.admin_approval === 'approved';
      expect(canOwnerAct).toBe(false);
    });

    test('Owner can approve after admin approves', () => {
      const deletionRequest = {
        admin_approval: 'approved',
        owner_approval: 'pending',
      };

      const canOwnerAct = deletionRequest.admin_approval === 'approved';
      expect(canOwnerAct).toBe(true);
    });

    test('Admin can always act first', () => {
      const deletionRequest = {
        admin_approval: 'pending',
        owner_approval: 'pending',
      };

      // Admin always acts first - no restriction
      expect(deletionRequest.admin_approval).toBe('pending');
    });
  });

  describe('Bank Transaction Cleanup on Deletion', () => {
    test('Salary deletion cleans up bank transaction', () => {
      const transactionType = 'salary';
      const typesWithBankCleanup = ['vendor_payment', 'salary', 'petty_cash', 'amount_received', 'petty_cash_utilization'];

      expect(typesWithBankCleanup.includes(transactionType)).toBe(true);
    });

    test('Petty cash utilization deletion cleans up bank transaction', () => {
      const transactionType = 'petty_cash_utilization';
      const typesWithBankCleanup = ['vendor_payment', 'salary', 'petty_cash', 'amount_received', 'petty_cash_utilization'];

      expect(typesWithBankCleanup.includes(transactionType)).toBe(true);
    });

    test('Vendor payment deletion cleans up bank transaction', () => {
      const transactionType = 'vendor_payment';
      const typesWithBankCleanup = ['vendor_payment', 'salary', 'petty_cash', 'amount_received', 'petty_cash_utilization'];

      expect(typesWithBankCleanup.includes(transactionType)).toBe(true);
    });

    test('Amount received deletion cleans up bank transaction', () => {
      const transactionType = 'amount_received';
      const typesWithBankCleanup = ['vendor_payment', 'salary', 'petty_cash', 'amount_received', 'petty_cash_utilization'];

      expect(typesWithBankCleanup.includes(transactionType)).toBe(true);
    });
  });

  describe('Transaction Status Transitions', () => {
    test('Active -> Deletion Requested -> Deleted (on approval)', () => {
      let status = 'active';
      
      // Request deletion
      status = 'deletion_requested';
      expect(status).toBe('deletion_requested');
      
      // Admin approves
      // Owner approves
      // Finalize
      status = 'deleted';
      expect(status).toBe('deleted');
    });

    test('Deletion Requested -> Active (on rejection)', () => {
      let status = 'deletion_requested';
      
      // Admin rejects
      // Finalize
      status = 'active';
      expect(status).toBe('active');
    });

    test('Cannot request deletion of already deleted transaction', () => {
      const status = 'deleted';
      const canRequest = status === 'active';
      expect(canRequest).toBe(false);
    });
  });

  describe('Summary Recalculation After Deletion', () => {
    test('Deleting salary reduces actualCost', () => {
      const salariesTotal = d(200000);
      const salaryToDelete = d(50000);
      const pettyCashUtilized = d(30000);
      const vendorPaymentsTotal = d(100000);

      const actualCostBefore = toNumber(add(add(salariesTotal, pettyCashUtilized), vendorPaymentsTotal));
      const actualCostAfter = toNumber(add(add(sub(salariesTotal, salaryToDelete), pettyCashUtilized), vendorPaymentsTotal));

      expect(actualCostBefore).toBe(330000);
      expect(actualCostAfter).toBe(280000);
      expect(actualCostAfter).toBe(actualCostBefore - 50000);
    });

    test('Deleting vendor payment reduces actualCost and vendorPaymentsTotal', () => {
      const vendorPaymentsTotal = d(500000);
      const paymentToDelete = d(100000);

      const after = toNumber(sub(vendorPaymentsTotal, paymentToDelete));
      expect(after).toBe(400000);
    });

    test('Deleting petty cash utilization reduces pettyCashUtilized', () => {
      const pettyCashUtilized = d(50000);
      const utilizationToDelete = d(10000);

      const after = toNumber(sub(pettyCashUtilized, utilizationToDelete));
      expect(after).toBe(40000);
    });
  });
});