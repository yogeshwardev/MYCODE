---
name: database
description: Database work - schema design, migrations, indexes, query optimization, data integrity and safe production changes for SQL (Postgres, MySQL, SQLite) and common ORMs.
triggers: database, schema, migration, sql, postgres, mysql, sqlite, index, query plan, orm, prisma, sequelize, typeorm, sqlalchemy, deadlock
---
1. **Learn the setup**: database engine and version, ORM or query builder, migration tool and existing migration style, and how tests get a database.
2. **Schema design**: use the right types (timestamps with time zone, numeric/decimal for money, never float), NOT NULL and sensible defaults, foreign keys with deliberate ON DELETE behavior, unique constraints for business rules, and check constraints where useful.
3. **Migrations must be safe on a live database**: additive first (add a nullable column, backfill in batches, then add the constraint), avoid long table locks (build Postgres indexes `CONCURRENTLY`), never rename or drop in the same deploy that stops using a column, and always provide a down migration or a written rollback plan.
4. **Queries**: always parameterized. Check plans with `EXPLAIN (ANALYZE, BUFFERS)` for anything on a hot path; add indexes that match the WHERE/JOIN/ORDER BY; avoid N+1 queries with eager loading or batching; paginate large results with keyset pagination.
5. **Integrity and concurrency**: wrap multi-step changes in transactions, choose the isolation level deliberately, use `SELECT ... FOR UPDATE` or optimistic locking for read-modify-write, and make retries idempotent.
6. **Verify**: run migrations up and down on a scratch database, run the tests, and include before/after query plans for performance changes.
