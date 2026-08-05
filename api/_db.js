// Shared Postgres connection helper, via Vercel's "Prisma Postgres" integration.
//
// Verified live (2026-08-05): all three philo_gorillas_* vars are plain
// postgres:// TCP connection strings to db.prisma.io (Prisma's own pooler) —
// none of them are in Accelerate's prisma:// protocol, despite the
// PRISMA_DATABASE_URL name suggesting otherwise. So this uses a direct driver
// adapter (@prisma/adapter-pg + pg), not Prisma 7's `accelerateUrl` option.
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const CONNECTION_VARS = [
  "philo_gorillas_DATABASE_URL",
  "philo_gorillas_POSTGRES_URL",
  "philo_gorillas_PRISMA_DATABASE_URL"
];

function resolveConnectionString() {
  for (const name of CONNECTION_VARS) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim().length > 0) return { name, value: v };
  }
  return null;
}

let cached = null;

function client() {
  if (cached) return cached;
  const found = resolveConnectionString();
  if (!found) {
    throw new Error(
      "No database connection string found. Checked: " + CONNECTION_VARS.join(", ")
    );
  }
  const adapter = new PrismaPg({ connectionString: found.value });
  cached = new PrismaClient({ adapter });
  return cached;
}

module.exports = { client, resolveConnectionString, CONNECTION_VARS };
