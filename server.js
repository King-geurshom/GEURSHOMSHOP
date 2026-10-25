```javascript
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const sessions = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error("Shyira ADMIN_USERNAME na ADMIN_PASSWORD muri environment variables.");
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(PRODUCTS_FILE)) {
  fs.writeFileSync(PRODUCTS_FILE, "[]", "utf8");
}

function readProducts() {
  const products = JSON.parse(
    fs.readFileSync(PRODUCTS_FILE, "utf8")
  );

  if (!Array.isArray(products)) {
    throw new Error("Products data igomba kuba array.");
  }

  return products;
}

function saveProducts(products) {
  const temporaryFile = PRODUCTS_FILE + ".tmp";

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(products, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, PRODUCTS_FILE);
}

function validProduct(data) {
  if (!data || typeof data !== "object") {
    return "Amakuru y'igicuruzwa si yo.";
  }

  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 120
  ) {
    return "Andika izina ry'igicuruzwa.";
  }

  if (
    typeof data.category !== "string" ||
    !data.category.trim() ||
    data.category.length > 100
  ) {
    return "Andika icyiciro cy'igicuruzwa.";
  }

  if (
    typeof data.price !== "number" ||
    !Number.isSafeInteger(data.price) ||
    data.price < 0 ||
    data.price > 1000000000
  ) {
    return "Igiciro kigomba kuba umubare wuzuye muri RWF.";
  }

  if (data.image !== undefined && typeof data.image !== "string") {
    return "Link y'ifoto si yo.";
  }

  if (data.image && data.image.length > 1000) {
    return "Link y'ifoto ni ndende cyane.";
  }

  if (data.image) {
    try {
      if (new URL(data.image).protocol !== "https:") {
        return "Link y'ifoto igomba gukoresha HTTPS.";
      }
    } catch {
      return "Link y'ifoto si yo.";
    }
  }

  if (
    data.description !== undefined &&
    (
      typeof data.description !== "string" ||
      data.description.length > 1000
    )
  ) {
    return "Ibisobanuro ni birebire cyane.";
  }

  return null;
}

function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer ([a-f0-9]+)$/i);

  if (!match) {
    return res.status(401).json({
      message: "Banza winjire muri Admin."
    });
  }

  const token = match[1];
  const expiry = sessions.get(token);

  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);

    return res.status(401).json({
      message: "Session yarangiye. Ongera winjire."
    });
  }

  next();
}

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      message: "Andika username na password."
    });
  }

  const sameUsername = username === ADMIN_USERNAME;

  const samePassword =
    Buffer.byteLength(password) === Buffer.byteLength(ADMIN_PASSWORD) &&
    crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(ADMIN_PASSWORD)
    );

  if (!sameUsername || !samePassword) {
    return res.status(401).json({
      message: "Username cyangwa password si byo."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);

  res.json({
    message: "Winjiye neza.",
    token
  });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.headers.authorization.slice(7);

  sessions.delete(token);

  res.json({ message: "Wasohotse muri Admin." });
});

// Abakiriya bashobora kureba ibicuruzwa.
app.get("/api/products", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(readProducts());
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Ntibishobotse gusoma ibicuruzwa."
    });
  }
});

// Admin yongeraho igicuruzwa.
app.post("/api/products", requireAdmin, (req, res) => {
  const error = validProduct(req.body);

  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const products = readProducts();

    const product = {
      id: crypto.randomUUID(),
      name: req.body.name.trim(),
      category: req.body.category.trim(),
      price: req.body.price,
      image: (req.body.image || "").trim(),
      description: (req.body.description || "").trim()
    };

    products.push(product);
    saveProducts(products);

    res.status(201).json({
      message: "Igicuruzwa cyongeweho.",
      product
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Habaye ikibazo mu kubika igicuruzwa."
    });
  }
});

// Admin ahindura igicuruzwa.
app.put("/api/products/:id", requireAdmin, (req, res) => {
  const error = validProduct(req.body);

  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const products = readProducts();

    const index = products.findIndex(
      product => product.id === req.params.id
    );

    if (index === -1) {
      return res.status(404).json({
        message: "Igicuruzwa nticyabonetse."
      });
    }

    products[index] = {
      ...products[index],
      name: req.body.name.trim(),
      category: req.body.category.trim(),
      price: req.body.price,
      image: (req.body.image || "").trim(),
      description: (req.body.description || "").trim()
    };

    saveProducts(products);

    res.json({
      message: "Igicuruzwa cyahinduwe.",
      product: products[index]
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Habaye ikibazo mu guhindura igicuruzwa."
    });
  }
});

// Admin asiba igicuruzwa.
app.delete("/api/products/:id", requireAdmin, (req, res) => {
  try {
    const products = readProducts();

    const updatedProducts = products.filter(
      product => product.id !== req.params.id
    );

    if (updatedProducts.length === products.length) {
      return res.status(404).json({
        message: "Igicuruzwa nticyabonetse."
      });
    }

    saveProducts(updatedProducts);

    res.json({ message: "Igicuruzwa cyasibwe." });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Habaye ikibazo mu gusiba igicuruzwa."
    });
  }
});

// Website n'Admin.
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Geurshom Modern Shop iri gukora kuri port ${PORT}`);
});
```
