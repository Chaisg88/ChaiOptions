import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function openStorage({ databaseUrl, dataDir, schema = "public" }) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid database schema name");
  const qualify = (text) =>
    text.replace(
      /\b(FROM|JOIN|INTO|UPDATE|REFERENCES|TABLE IF NOT EXISTS)\s+(users|sessions|trades)\b/gi,
      (_, operation, table) =>
        `${operation} "${schema}".${table.toLowerCase()}`,
    );
  const query = (connection, text, ...args) =>
    connection.query(qualify(text), ...args);
  let sqlite, pool;
  const sql = (text) => {
    let i = 0;
    return text.replace(/\?/g, () => `$${++i}`);
  };
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 15000,
    });
    pool.on("error", () =>
      console.error(
        "Database connection lost; the next request will reconnect.",
      ),
    );
    if (schema !== "public")
      await query(pool, `CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await query(
      pool,
      `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      must_change INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), data TEXT NOT NULL);`,
    );
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    sqlite = new DatabaseSync(
      path.join(
        dataDir,
        schema === "public" ? "chai.sqlite" : `${schema}.sqlite`,
      ),
    );
    sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),data TEXT NOT NULL);`);
    if (
      !sqlite
        .prepare("PRAGMA table_info(users)")
        .all()
        .some((c) => c.name === "revision")
    )
      sqlite.exec(
        "ALTER TABLE users ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
  }
  return {
    kind: pool ? "postgres" : "sqlite",
    async get(text, ...params) {
      return pool
        ? (await query(pool, sql(text), params)).rows[0]
        : sqlite.prepare(text).get(...params);
    },
    async run(text, ...params) {
      return pool
        ? query(pool, sql(text), params)
        : sqlite.prepare(text).run(...params);
    },
    async ping() {
      return pool ? query(pool, "SELECT 1") : sqlite.prepare("SELECT 1").get();
    },
    async snapshot(userId) {
      if (pool) {
        const row = (
          await query(
            pool,
            `SELECT revision, COALESCE((SELECT json_agg(data::json) FROM trades WHERE user_id=users.id),'[]'::json) AS trades FROM users WHERE id=$1`,
            [userId],
          )
        ).rows[0];
        return row;
      }
      return {
        revision: sqlite
          .prepare("SELECT revision FROM users WHERE id=?")
          .get(userId).revision,
        trades: sqlite
          .prepare("SELECT data FROM trades WHERE user_id=?")
          .all(userId)
          .map((row) => JSON.parse(row.data)),
      };
    },
    async replace(userId, revision, trades) {
      if (pool) {
        const connection = await pool.connect();
        try {
          await query(connection, "BEGIN");
          const updated = await query(
            connection,
            "UPDATE users SET revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING revision",
            [userId, revision],
          );
          if (!updated.rowCount) {
            await query(connection, "ROLLBACK");
            return null;
          }
          await query(connection, "DELETE FROM trades WHERE user_id=$1", [
            userId,
          ]);
          for (const trade of trades)
            await query(
              connection,
              "INSERT INTO trades(id,user_id,data) VALUES($1,$2,$3)",
              [trade.id, userId, JSON.stringify(trade)],
            );
          await query(connection, "COMMIT");
          return updated.rows[0].revision;
        } catch (error) {
          await query(connection, "ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
      }
      sqlite.exec("BEGIN");
      try {
        if (
          sqlite.prepare("SELECT revision FROM users WHERE id=?").get(userId)
            .revision !== revision
        ) {
          sqlite.exec("ROLLBACK");
          return null;
        }
        sqlite.prepare("DELETE FROM trades WHERE user_id=?").run(userId);
        const insert = sqlite.prepare(
          "INSERT INTO trades(id,user_id,data) VALUES(?,?,?)",
        );
        for (const trade of trades)
          insert.run(trade.id, userId, JSON.stringify(trade));
        sqlite
          .prepare("UPDATE users SET revision=revision+1 WHERE id=?")
          .run(userId);
        sqlite.exec("COMMIT");
        return revision + 1;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      if (pool) await pool.end();
      else sqlite.close();
    },
  };
}
