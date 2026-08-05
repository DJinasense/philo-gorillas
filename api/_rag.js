// Chunking, embedding, and retrieval for the philosopher "library" (RAG over the
// five public-domain source texts in data/texts/). See CLAUDE.md section 3 for
// which edition belongs to which philosopher.
const fs = require("fs");
const path = require("path");

// philosopher id -> source files that make up their library.
const SOURCES = {
  plato:     [{ file: "republic.txt", source: "republic" }],
  nietzsche: [
    { file: "beyond-good-evil.txt", source: "beyond-good-evil" },
    { file: "zarathustra.txt",      source: "zarathustra" }
  ],
  descartes: [{ file: "discourse-method.txt", source: "discourse-method" }],
  marcus:    [{ file: "meditations.txt", source: "meditations" }]
};

const TARGET_CHUNK_CHARS = 1500;

function stripGutenbergBoilerplate(text) {
  const start = text.search(/\*\*\* START OF[^\n]*\*\*\*/i);
  const end   = text.search(/\*\*\* END OF[^\n]*\*\*\*/i);
  const startIdx = start === -1 ? 0 : text.indexOf("\n", start) + 1;
  const endIdx   = end === -1 ? text.length : end;
  return text.slice(startIdx, endIdx).trim();
}

// Groups paragraphs (blank-line separated) into ~TARGET_CHUNK_CHARS chunks,
// never splitting a paragraph across chunks unless it alone exceeds the target.
function chunkText(text) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    if (current && (current.length + para.length + 1) > TARGET_CHUNK_CHARS) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n" + para : para;
    }
    while (current.length > TARGET_CHUNK_CHARS * 2) {
      chunks.push(current.slice(0, TARGET_CHUNK_CHARS));
      current = current.slice(TARGET_CHUNK_CHARS);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function loadChunks(source) {
  for (const philosopher of Object.keys(SOURCES)) {
    for (const entry of SOURCES[philosopher]) {
      if (entry.source === source) {
        const raw = fs.readFileSync(path.join(process.cwd(), "data", "texts", entry.file), "utf8");
        return { philosopher, chunks: chunkText(stripGutenbergBoilerplate(raw)) };
      }
    }
  }
  return null;
}

function allSources() {
  const list = [];
  for (const philosopher of Object.keys(SOURCES)) {
    for (const entry of SOURCES[philosopher]) list.push({ philosopher, source: entry.source });
  }
  return list;
}

async function embedBatch(apiKey, texts) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=" + encodeURIComponent(apiKey);
  const body = {
    requests: texts.map(t => ({
      model: "models/text-embedding-004",
      content: { parts: [{ text: t }] }
    }))
  };
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await upstream.text();
  if (!upstream.ok) throw new Error("Gemini embedding " + upstream.status + ": " + raw.slice(0, 500));
  const data = JSON.parse(raw);
  return data.embeddings.map(e => e.values);
}

async function embedOne(apiKey, text) {
  const [values] = await embedBatch(apiKey, [text]);
  return values;
}

function toVectorLiteral(values) {
  return "[" + values.join(",") + "]";
}

// Returns up to `limit` passages for the given philosopher, most relevant to
// `query` first. Empty array (never throws) if RAG isn't populated yet, so
// callers can treat "no passages" the same as "RAG not built for this persona".
async function retrievePassages({ db, geminiKey, philosopher, query, limit = 3 }) {
  if (!db || !geminiKey) return [];
  try {
    const values = await embedOne(geminiKey, query);
    const vec = toVectorLiteral(values);
    const rows = await db.$queryRawUnsafe(
      `SELECT chunk_text, source FROM passages WHERE philosopher = $1 ORDER BY embedding <=> $2::vector LIMIT $3`,
      philosopher, vec, limit
    );
    return rows.map(r => ({ text: r.chunk_text, source: r.source }));
  } catch (e) {
    return [];
  }
}

module.exports = { SOURCES, chunkText, stripGutenbergBoilerplate, loadChunks, allSources, embedBatch, embedOne, toVectorLiteral, retrievePassages };
