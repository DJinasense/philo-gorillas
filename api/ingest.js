// One-shot(ish), resumable ingestion for the RAG library. Chunks a source text,
// embeds any chunks not yet stored (via Gemini text-embedding-004), and inserts
// them. Safe to call repeatedly — picks up from the highest chunk_index already
// in the DB for that source, so a timed-out or partial run just continues.
//
//   curl -X POST https://<domain>/api/ingest -H "x-admin-key: <ADMIN_SECRET>" \
//        -H "content-type: application/json" -d '{"source":"republic","batchSize":80}'
//
// Call with {"source":"all"} to see progress across every source without ingesting.
const { client } = require("./_db.js");
const { loadChunks, allSources, embedBatch } = require("./_rag.js");

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

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not set — required to embed passages." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const sourceParam = typeof body.source === "string" ? body.source : null;
  const batchSize = Number.isInteger(body.batchSize) ? Math.min(body.batchSize, 100) : 80;

  if (!sourceParam) {
    res.status(400).json({ error: "Body must include { source }. Use \"all\" to list progress for every source." });
    return;
  }

  try {
    const db = client();

    if (sourceParam === "all") {
      const progress = [];
      for (const { philosopher, source } of allSources()) {
        const loaded = loadChunks(source);
        const [{ count }] = await db.$queryRawUnsafe(
          "SELECT count(*)::int AS count FROM passages WHERE source = $1", source
        );
        progress.push({ philosopher, source, totalChunks: loaded.chunks.length, storedChunks: count, remaining: loaded.chunks.length - count });
      }
      res.status(200).json({ ok: true, progress });
      return;
    }

    const loaded = loadChunks(sourceParam);
    if (!loaded) {
      res.status(400).json({ error: "Unknown source: " + sourceParam });
      return;
    }
    const { philosopher, chunks } = loaded;

    const [{ maxIdx }] = await db.$queryRawUnsafe(
      "SELECT COALESCE(MAX(chunk_index), -1)::int AS \"maxIdx\" FROM passages WHERE source = $1", sourceParam
    );
    const startIdx = maxIdx + 1;
    const batch = chunks.slice(startIdx, startIdx + batchSize);

    if (batch.length === 0) {
      res.status(200).json({ ok: true, source: sourceParam, philosopher, totalChunks: chunks.length, inserted: 0, remaining: 0, done: true });
      return;
    }

    const embeddings = await embedBatch(geminiKey, batch);

    for (let i = 0; i < batch.length; i++) {
      const vec = "[" + embeddings[i].join(",") + "]";
      await db.$executeRawUnsafe(
        `INSERT INTO passages (philosopher, source, chunk_index, chunk_text, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (source, chunk_index) DO NOTHING`,
        philosopher, sourceParam, startIdx + i, batch[i], vec
      );
    }

    const remaining = chunks.length - (startIdx + batch.length);
    res.status(200).json({
      ok: true,
      source: sourceParam,
      philosopher,
      totalChunks: chunks.length,
      inserted: batch.length,
      nextIndex: startIdx + batch.length,
      remaining: Math.max(remaining, 0),
      done: remaining <= 0
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
  }
};
