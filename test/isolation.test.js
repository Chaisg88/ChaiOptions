import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { openStorage } from "../storage.js";

async function verifyIsolation(databaseUrl) {
  const dir = await mkdtemp(path.join(tmpdir(), "options-isolation-"));
  const suffix = randomBytes(6).toString("hex");
  const schemas = [`test_chai_${suffix}`, `test_jean_${suffix}`];
  const stores = [];
  try {
    for (const schema of schemas)
      stores.push(await openStorage({ databaseUrl, dataDir: dir, schema }));
    const [chai, jean] = stores;
    await chai.run(
      "INSERT INTO users(email,password) VALUES (?,?)",
      "chai@example.com",
      "test-hash",
    );
    await jean.run(
      "INSERT INTO users(email,password) VALUES (?,?)",
      "jean@example.com",
      "different-test-hash",
    );
    const chaiUser = await chai.get("SELECT * FROM users");
    const jeanUser = await jean.get("SELECT * FROM users");
    assert.equal(chaiUser.email, "chai@example.com");
    assert.equal(jeanUser.email, "jean@example.com");
    assert.equal(
      await jean.get("SELECT id FROM users WHERE email=?", chaiUser.email),
      undefined,
    );
    await chai.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      "chai-session",
      chaiUser.id,
      Date.now() + 10000,
    );
    assert.equal(
      await jean.get("SELECT * FROM sessions WHERE token=?", "chai-session"),
      undefined,
    );
    assert.equal(
      await chai.replace(chaiUser.id, 0, [{ id: "same-id", symbol: "AAPL" }]),
      1,
    );
    assert.deepEqual(await jean.snapshot(jeanUser.id), {
      revision: 0,
      trades: [],
    });
    assert.equal(
      await jean.replace(jeanUser.id, 0, [{ id: "same-id", symbol: "MSFT" }]),
      1,
    );
    assert.equal((await chai.snapshot(chaiUser.id)).trades[0].symbol, "AAPL");
    assert.equal((await jean.snapshot(jeanUser.id)).trades[0].symbol, "MSFT");
  } finally {
    if (databaseUrl)
      for (let i = 0; i < stores.length; i++)
        await stores[i].run(`DROP SCHEMA IF EXISTS "${schemas[i]}" CASCADE`);
    for (const store of stores) await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test("separate app instances cannot see each other’s users, sessions or trades (SQLite)", () =>
  verifyIsolation());
test(
  "separate app schemas isolate users, sessions and trades (PostgreSQL)",
  { skip: !process.env.TEST_DATABASE_URL },
  () => verifyIsolation(process.env.TEST_DATABASE_URL),
);
test("reject invalid schema names before opening a database", async () => {
  await assert.rejects(
    openStorage({ dataDir: "/tmp", schema: "public; DROP TABLE users" }),
    /Invalid database schema/,
  );
});
