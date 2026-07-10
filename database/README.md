# Database

The project uses MySQL 8 and versioned SQL migrations.

## Commands

```bash
npm run db:migrate
npm run db:status
```

Migration files are immutable after they have been applied. Add a new numbered
file under `database/migrations/` for every schema change.

`schema_migrations` is maintained by the migration runner and records the file
name and SHA-256 checksum of every applied migration.

The application stores stable business state in relational tables. AI-generated
plan and question payloads remain JSON snapshots, while task progress and quiz
attempts are stored separately so they can be updated and queried safely.
