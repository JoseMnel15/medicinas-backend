const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.API_KEY || "dev-token";
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("DATABASE_URL no está configurada. Configúrala para usar Postgres.");
}

const ssl =
  process.env.PGSSL === "true" ||
  process.env.PGSSLMODE === "require" ||
  process.env.PGSSLMODE === "verify-full"
    ? { rejectUnauthorized: false }
    : false;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl,
    })
  : null;

const ensureTable = async () => {
  if (!pool) return;
  await pool.query(`
    create table if not exists products (
      id text primary key,
      name text not null,
      brand text not null,
      category text,
      size text,
      image text,
      alt text,
      featured boolean default false,
      detail jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `);
};

const requireAuth = (req, res, next) => {
  const headerToken = req.headers["x-api-key"] || "";
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const token = headerToken || bearer;

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
};

const formatRow = (row) => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  category: row.category,
  size: row.size,
  image: row.image,
  alt: row.alt,
  featured: row.featured,
  detail: row.detail || {},
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const upsertProduct = (payload, existing) => {
  const now = new Date().toISOString();
  const base = existing || {};
  const priceOptions = Array.isArray(payload?.detail?.priceOptions)
    ? payload.detail.priceOptions
    : base.detail?.priceOptions || [];

  const detail = {
    ...base.detail,
    ...payload.detail,
    priceOptions,
  };

  return {
    ...base,
    ...payload,
    id: (payload.id || base.id || "").trim() || crypto.randomUUID(),
    updatedAt: now,
    createdAt: base.createdAt || now,
    detail,
  };
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ mensaje: "API funcionando", version: "1.1.0" });
});

app.get("/products", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Base de datos no configurada" });
  }
  try {
    const { rows } = await pool.query("select * from products order by updated_at desc");
    res.json(rows.map(formatRow));
  } catch (err) {
    console.error("Error listando productos", err);
    res.status(500).json({ error: "No se pudieron obtener los productos" });
  }
});

app.get("/products/:id", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Base de datos no configurada" });
  }
  try {
    const { rows } = await pool.query("select * from products where id = $1 limit 1", [
      req.params.id,
    ]);
    if (!rows.length) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json(formatRow(rows[0]));
  } catch (err) {
    console.error("Error obteniendo producto", err);
    res.status(500).json({ error: "No se pudo obtener el producto" });
  }
});

app.post("/products", requireAuth, async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Base de datos no configurada" });
  }
  const payload = req.body || {};
  if (!payload.name || !payload.brand) {
    return res.status(400).json({ error: "Faltan campos obligatorios (name, brand)" });
  }

  const product = upsertProduct(payload, null);

  try {
    const { rows } = await pool.query(
      `
        insert into products (id, name, brand, category, size, image, alt, featured, detail, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        returning *
      `,
      [
        product.id,
        product.name,
        product.brand,
        product.category || null,
        product.size || null,
        product.image || null,
        product.alt || null,
        product.featured || false,
        product.detail || {},
        product.createdAt,
        product.updatedAt,
      ],
    );
    res.status(201).json(formatRow(rows[0]));
  } catch (err) {
    console.error("Error creando producto", err);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

app.put("/products/:id", requireAuth, async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Base de datos no configurada" });
  }
  const payload = req.body || {};

  try {
    const existing = await pool.query("select * from products where id = $1 limit 1", [
      req.params.id,
    ]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const product = upsertProduct(payload, formatRow(existing.rows[0]));
    const { rows } = await pool.query(
      `
        update products
        set name=$2, brand=$3, category=$4, size=$5, image=$6, alt=$7, featured=$8, detail=$9, updated_at=$10
        where id=$1
        returning *
      `,
      [
        product.id,
        product.name,
        product.brand,
        product.category || null,
        product.size || null,
        product.image || null,
        product.alt || null,
        product.featured || false,
        product.detail || {},
        product.updatedAt,
      ],
    );
    res.json(formatRow(rows[0]));
  } catch (err) {
    console.error("Error actualizando producto", err);
    res.status(500).json({ error: "No se pudo actualizar el producto" });
  }
});

app.delete("/products/:id", requireAuth, async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Base de datos no configurada" });
  }
  try {
    const result = await pool.query("delete from products where id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando producto", err);
    res.status(500).json({ error: "No se pudo eliminar el producto" });
  }
});

app.listen(PORT, async () => {
  try {
    await ensureTable();
    console.log("Tabla products verificada");
  } catch (err) {
    console.error("Error al preparar la base de datos", err);
  }
  console.log(`Servidor en puerto ${PORT}`);
});
