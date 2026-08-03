# Inventory & Asset Management System (IMS)

Enterprise-grade construction inventory and asset management system for large-scale construction companies in Pakistan. Built with Node.js, Express, React, and PostgreSQL.

## Features

- **Dashboard** - Real-time KPIs: inventory value, active projects, vehicle utilization, low-stock alerts, maintenance due, activity feed
- **Materials Inventory** - Full CRUD with SKU tracking, category management, stock in/out logging, reorder alerts
- **Vehicles Management** - Truck/excavator/crane/Mixer tracking with fuel logs, maintenance scheduling, insurance/registration expiry alerts
- **Tools & Equipment** - Checkout/checkin workflow, maintenance schedules, calibration tracking
- **Projects** - Budget tracking, resource allocation (materials/vehicles/tools), consumption monitoring
- **Vendors/Suppliers** - Directory, purchase orders with approval workflow, delivery tracking
- **Warehouses/Sites** - Multi-location stock management, inter-warehouse transfers with approval
- **Reports** - Stock valuation, project usage, vehicle utilization, maintenance due, vendor purchases - exportable to Excel/PDF
- **User Management** - Role-based access (Admin, Store Manager, Site Engineer, Procurement Officer), full audit logging
- **Backup & Restore** - Automated daily backups, manual export/restore

## Prerequisites

- **Node.js** >= 18
- **PostgreSQL** >= 14 (running locally on port 5432)
- **npm** >= 9

## Database Setup

The system connects to PostgreSQL with these credentials:
```
Host: localhost
Port: 5432
Database: ims_db
User: postgres
Password: postgres
```

Create the database:
```sql
CREATE DATABASE ims_db;
```

## Installation

### 1. Clone and install dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Configure environment

Edit `server/.env` if your database credentials differ from defaults:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ims_db
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=24h
PORT=5000
```

### 3. Start the application

```bash
# Start backend server (from server/ directory)
npm start
# Server runs on http://localhost:5000

# Start frontend dev server (from client/ directory - in a new terminal)
npm run dev
# Client runs on http://localhost:3000
```

### 4. Login

The system is pre-seeded with sample data when a database is first created (dev environments only).
Each demo account has a unique password supplied via environment variables
(`SEED_PASSWORD_ADMIN`, `SEED_PASSWORD_STORE`, `SEED_PASSWORD_ENGINEER`, `SEED_PASSWORD_PROCUREMENT`,
`SEED_PASSWORD_OWNER`, `SEED_PASSWORD_MANAGER`, `SEED_PASSWORD_STAFF`, `SEED_PASSWORD_FINANCE`),
falling back to `SEED_PASSWORD`. Demo account passwords are not committed to this repository;
ask your administrator for the current credentials.

| Role | Email |
|------|-------|
| Admin | admin@ims.com |
| Store Manager | store@ims.com |
| Site Engineer | engineer@ims.com |
| Procurement Officer | procurement@ims.com |
| Owner | owner@ims.com |
| Manager | manager@ims.com |
| Staff | staff@ims.com |
| Finance | finance@ims.com |

> Seeding is disabled automatically in production (`NODE_ENV=production`). It only runs when
> `SEED_ENABLED=true` is explicitly set.

## Backup & Restore

### Automated Backups
The system automatically creates a database backup at 2:00 AM daily. Backups are stored in the `backups/` directory as SQL dump files.

### Manual Backup (via UI)
1. Login as Admin
2. Navigate to **Backup** from the sidebar
3. Click **Export Full Backup** to download a SQL dump
4. The file includes all tables with INSERT statements

### Restore from Backup
1. Login as Admin
2. Navigate to **Backup**
3. Click **Restore** next to any backup file
4. Confirm the restore action

### Manual Backup via Command Line
```bash
# Using pg_dump
pg_dump -h localhost -U postgres -d ims_db > backup_$(date +%Y-%m-%d).sql

# Restore
psql -h localhost -U postgres -d ims_db < backup_file.sql
```

## Project Structure

```
IMS/
├── server/
│   ├── backups/              # Database backup files
│   ├── src/
│   │   ├── db/
│   │   │   ├── pool.js       # PostgreSQL connection pool
│   │   │   ├── schema.js     # Database schema (CREATE TABLE)
│   │   │   ├── seed.js       # Seed data (Pakistani construction data)
│   │   │   └── helpers.js    # Audit/activity log helpers
│   │   ├── middleware/
│   │   │   └── auth.js       # JWT authentication & role authorization
│   │   ├── routes/
│   │   │   ├── auth.js       # Login, JWT token generation
│   │   │   ├── materials.js  # Materials CRUD + stock movements
│   │   │   ├── vehicles.js   # Vehicles CRUD + fuel/maintenance logs
│   │   │   ├── tools.js      # Tools CRUD + checkout/checkin
│   │   │   ├── projects.js   # Projects CRUD + allocations
│   │   │   ├── vendors.js    # Vendors + Purchase Orders
│   │   │   ├── warehouses.js # Warehouses + Transfer requests
│   │   │   ├── reports.js    # All reports + Excel/PDF export
│   │   │   ├── dashboard.js  # Dashboard KPIs
│   │   │   ├── users.js      # User management
│   │   │   └── backup.js     # Backup export/restore
│   │   └── index.js          # Express server entry point
│   └── .env                  # Environment variables
├── client/
│   ├── src/
│   │   ├── pages/            # React page components
│   │   ├── components/       # Layout, Modal, etc.
│   │   ├── context/          # AuthContext
│   │   ├── api.js            # Axios instance with JWT interceptor
│   │   ├── App.jsx           # Router configuration
│   │   └── main.jsx          # Entry point
│   └── vite.config.js        # Vite config with API proxy
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | User login |
| GET | /api/auth/me | Current user info |
| GET/POST/PUT/DELETE | /api/materials | Materials CRUD |
| POST | /api/materials/:id/movement | Stock in/out |
| POST | /api/materials/:id/checkout | Check out material |
| GET | /api/materials/categories/list | Category list |
| GET/POST/PUT/DELETE | /api/vehicles | Vehicles CRUD |
| POST | /api/vehicles/:id/fuel | Add fuel log |
| POST | /api/vehicles/:id/maintenance | Add maintenance log |
| GET/POST/PUT/DELETE | /api/tools | Tools CRUD |
| POST | /api/tools/:id/checkout | Checkout tool |
| POST | /api/tools/:id/checkin | Checkin tool |
| GET/POST/PUT/DELETE | /api/projects | Projects CRUD |
| GET/POST | /api/projects/:id/allocations | Resource allocations |
| GET/POST/PUT/DELETE | /api/vendors | Vendors CRUD |
| GET/POST | /api/vendors/pos | Purchase orders |
| PUT | /api/vendors/pos/:id/approve | Approve PO |
| PUT | /api/vendors/pos/:id/delivery | Update delivery |
| GET/POST/PUT | /api/warehouses | Warehouses CRUD |
| GET/POST/PUT | /api/warehouses/transfers | Transfer requests |
| GET | /api/reports/* | All reports + export |
| GET | /api/dashboard | Dashboard data |
| GET/POST/PUT | /api/users | User management |
| GET | /api/users/audit-logs | Audit trail |
| GET | /api/backup/export | Download backup |
| POST | /api/backup/restore | Restore from backup |
| GET | /api/backup/list | List backup files |

## Roles & Permissions

- **Admin** - Full access to all modules, including user management and backup/restore
- **Store Manager** - Inventory, vehicles, tools, warehouses, reports
- **Site Engineer** - Projects, tools checkout, material requests
- **Procurement Officer** - Vendors, purchase orders, reports

## Tech Stack

- **Frontend**: React 19, Tailwind CSS 4, Vite, React Router, Axios, Recharts
- **Backend**: Node.js, Express 4, PostgreSQL, JWT (jsonwebtoken), bcryptjs
- **Reports**: ExcelJS (Excel export), PDFKit (PDF export)
- **Tasks**: node-cron (scheduled backups)

## Seed Data

The system is pre-populated with realistic Pakistani construction data:
- **24 materials** across 10 categories (cement, steel, aggregate, bricks, electrical, plumbing, paint, wood, chemicals, safety)
- **10 vehicles** (concrete mixers, excavators, dump trucks, cranes, wheel loaders)
- **15 tools** (power tools, surveying equipment, safety gear, scaffolding)
- **6 mega-projects** (Bahria Town, Karachi Metro Bus, Blue Area Tower, etc.)
- **8 vendors** (Lucky Cement, Pakistan Steel, Siemens, etc.)
- **7 warehouses** across main stores and site stores
- **4 users** with different roles
- All prices in PKR