-- Enable Supabase Realtime on tables for live tracking
-- Run this in Supabase SQL Editor or via psql

-- Enable realtime for inventory/materials tracking
ALTER PUBLICATION supabase_realtime ADD TABLE materials;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE material_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE warehouses;

-- Enable realtime for gate passes
ALTER PUBLICATION supabase_realtime ADD TABLE gate_passes;

-- Enable realtime for purchase orders
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE purchase_order_items;

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Enable realtime for projects
ALTER PUBLICATION supabase_realtime ADD TABLE projects;

-- Enable realtime for vehicles and tools
ALTER PUBLICATION supabase_realtime ADD TABLE vehicles;
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_fuel_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_maintenance_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE tools;
ALTER PUBLICATION supabase_realtime ADD TABLE tool_checkout_log;

-- Enable realtime for transfer requests
ALTER PUBLICATION supabase_realtime ADD TABLE transfer_requests;

-- Enable realtime for project allocations
ALTER PUBLICATION supabase_realtime ADD TABLE project_allocations;

-- Enable realtime for finance tables
ALTER PUBLICATION supabase_realtime ADD TABLE salaries;
ALTER PUBLICATION supabase_realtime ADD TABLE petty_cash;
ALTER PUBLICATION supabase_realtime ADD TABLE petty_cash_utilization;
ALTER PUBLICATION supabase_realtime ADD TABLE vendor_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE banks;
ALTER PUBLICATION supabase_realtime ADD TABLE bank_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE amount_received;
ALTER PUBLICATION supabase_realtime ADD TABLE deletion_requests;

-- Enable realtime for activity feed and audit logs
ALTER PUBLICATION supabase_realtime ADD TABLE activity_feed;
ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;

-- Verify the publication
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';