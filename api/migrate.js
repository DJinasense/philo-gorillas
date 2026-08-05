// One-shot(ish) schema setup for the freemium user system. Safe to call repeatedly —
// every statement is idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).
//
// Gated by a shared secret so this can't be triggered by anyone who finds the URL:
// set ADMIN_SECRET in Vercel to any random string of your own choosing (don't need to
// tell Claude the value), then call this with that value in the x-admin-key header:
//
//   curl -X POST https://<your-domain>/api/migrate -H "x-admin-key: <your ADMIN_SECRET>"
//
// GET requests are rejected so a stray browser visit / crawler can't trigger it.
const { client } = require("./_db.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const provided = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_SECRET;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_SECRET is not set in this environment." });
    return;
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Missing or invalid x-admin-key header." });
    return;
  }

  try {
    const db = client();

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id                    BIGSERIAL PRIMARY KEY,
        email                 TEXT NOT NULL UNIQUE,
        verified              BOOLEAN NOT NULL DEFAULT FALSE,
        verification_token    TEXT,
        verification_expires  TIMESTAMPTZ,
        free_questions_used   INTEGER NOT NULL DEFAULT 0,
        stripe_customer_id    TEXT,
        is_pro                BOOLEAN NOT NULL DEFAULT FALSE,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS users_verification_token_idx ON users (verification_token)");
    await db.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS users_stripe_customer_id_idx ON users (stripe_customer_id)");

    const [{ count }] = await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM users");

    res.status(200).json({
      ok: true,
      message: "users table is ready.",
      existingRowCount: count
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
  }
};
