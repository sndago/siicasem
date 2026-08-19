# Siicasem

Branch-level banking operations platform for managing clients, accounts, loans, and transactions with role-based staff access and an approval workflow.

## Stack

- Node.js / Express
- MongoDB / Mongoose
- EJS server-rendered views
- express-session with connect-mongo (session store)
- Twilio (optional SMS notifications)

## Getting started

```bash
npm install
```

Create a `.env` file in the project root:

```
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/siicasem
SESSION_SECRET=replace-with-a-random-secret

# SMS notifications (Twilio) — optional, set to true once filled in below
SMS_NOTIFICATIONS_ENABLED=false
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
SMS_COUNTRY_CODE=+233
```

Run the app:

```bash
npm run dev    # nodemon, auto-restart
npm start      # plain node
```

On first run against an empty database, `config/seed.js` seeds default staff accounts and sample clients/transactions — check the console output for the generated login credentials.

## Roles

- **Teller** — manage assigned clients, submit transactions (pending approval)
- **Admin** — approve/reject transactions and client edits, manage tellers, branches, activity logs
- **Super Admin** — full access, including deleting records and restoring from the archive

## Structure

```
app.js / server.js   entry point, session/security middleware, scheduled loan interest job
config/               db connection, env validation, logger, seed data
controllers/          request handlers by domain (auth, clients, transactions, loans, users, branches, logs, archive)
middleware/           auth guards, idle timeout, flash messages, error handler
models/                Mongoose schemas (User, Client, Account, Transaction, Loan, Branch, ActivityLog)
routes/                route definitions
views/                 EJS templates
utils/                 SMS service, activity logging helper
```

## Notes

- Deleted clients/transactions/users are soft-archived and restorable from `/archive` (super admin only).
- A scheduled job in `server.js` periodically charges loan interest and sends SMS notifications when enabled.
