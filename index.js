const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");

const app = express();

const DATA_DIR = path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.API_KEY || "dev-token";
const PORT = process.env.PORT || 3000;

const ensureDataFile = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([]));
  }
};

const readProducts = () => {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error("Error leyendo productos", err);
    return [];
  }
};

const writeProducts = (products) => {
  ensureDataFile();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ mensaje: "API funcionando", version: "1.0.0" });
});

app.get("/products", (req, res) => {
  const products = readProducts();
  res.json(products);
});

app.get("/products/:id", (req, res) => {
  const products = readProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }
  res.json(product);
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

app.post("/products", requireAuth, (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.brand) {
    return res.status(400).json({ error: "Faltan campos obligatorios (name, brand)" });
  }
  const products = readProducts();
  const product = upsertProduct(payload, null);
  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

app.put("/products/:id", requireAuth, (req, res) => {
  const payload = req.body || {};
  const products = readProducts();
  const index = products.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }
  const updated = upsertProduct(payload, products[index]);
  products[index] = updated;
  writeProducts(products);
  res.json(updated);
});

app.delete("/products/:id", requireAuth, (req, res) => {
  const products = readProducts();
  const nextProducts = products.filter((p) => p.id !== req.params.id);
  if (nextProducts.length === products.length) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }
  writeProducts(nextProducts);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
