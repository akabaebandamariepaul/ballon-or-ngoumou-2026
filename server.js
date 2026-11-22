const express = require(“express”);
const crypto = require(“crypto”);
const axios = require(“axios”);
const { Pool } = require(“pg”);
require(“dotenv”).config();

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl: process.env.DATABASE_URL
? { rejectUnauthorized: false }
: false
});

const candidats = [
“Akaba Ebanda”,
“Belladinho”,
“Alane”,
“Batoum”,
“Choco”,
“Ngando”,
“Lavoisier”,
“Mbede”,
“Stéphane Esso”
];

const gardiens = [
“Bocchi”,
“Abanda Jores (Animal)”,
“Enzo NDjam (Mougnol)”,
“Ezonday”,
“TSALA”
];

async function initialiser() {
await pool.query(CREATE TABLE IF NOT EXISTS votes ( id SERIAL PRIMARY KEY, reference VARCHAR(100) UNIQUE NOT NULL, candidat VARCHAR(150) NOT NULL, categorie VARCHAR(30) NOT NULL, quantite INTEGER NOT NULL, montant INTEGER NOT NULL, statut VARCHAR(30) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ));
}

app.get(”/”, (req, res) => {
res.json({
plateforme: “BALLON D’OR NGOUMOU 2026”,
organisateur: “CLASSICO”,
prix_vote: 100,
devise: “XAF”,
categories: {
ballon_or: candidats,
meilleur_gardien: gardiens
},
statut: “Serveur opérationnel”
});
});

app.get(”/api/classement”, async (req, res) => {
try {
const result = await pool.query(SELECT candidat, categorie, SUM(quantite)::INTEGER AS votes FROM votes WHERE statut = 'paid' GROUP BY candidat, categorie ORDER BY votes DESC);

res.json(result.rows);

} catch (error) {
res.status(500).json({ error: “Erreur classement” });
}
});

app.post(”/api/voter”, express.json(), async (req, res) => {
try {
const { candidat, categorie, quantite, email } = req.body;

const liste = categorie === "gardien" ? gardiens : candidats;
if (!liste.includes(candidat)) {
  return res.status(400).json({ error: "Candidat invalide" });
}
if (!["ballon_or", "gardien"].includes(categorie)) {
  return res.status(400).json({ error: "Catégorie invalide" });
}
const nombre = Number(quantite);
if (!Number.isInteger(nombre) || nombre < 1 || nombre > 100) {
  return res.status(400).json({ error: "Nombre de votes invalide" });
}
const montant = nombre * 100;
const reference = "CLASSICO-" + crypto.randomUUID();
await pool.query(
  `INSERT INTO votes
  (reference, candidat, categorie, quantite, montant)
  VALUES ($1, $2, $3, $4, $5)`,
  [reference, candidat, categorie, nombre, montant]
);
const paiement = await axios.post(
  "https://api.notchpay.co/payments",
  {
    amount: montant,
    currency: "XAF",
    reference,
    customer: {
      email: email || "client@example.com"
    },
    callback: `${process.env.APP_URL}/paiement/retour`
  },
  {
    headers: {
      Authorization: process.env.NOTCHPAY_PUBLIC_KEY,
      "Content-Type": "application/json"
    }
  }
);
const donnees = paiement.data;
const url =
  donnees.authorization_url ||
  donnees.authorization?.url;
if (!url) {
  throw new Error("Lien de paiement absent");
}
res.json({
  message: "Paiement créé",
  reference,
  montant,
  paiement: url
});

} catch (error) {
console.error(“Erreur paiement :”, error.response?.data || error.message);
res.status(500).json({
error: “Impossible de créer le paiement”
});
}
});

// Réception des notifications sécurisées Notch Pay
app.post(
“/webhooks/notchpay”,
express.raw({ type: “application/json” }),
async (req, res) => {
try {
const signature = req.get(“x-notch-signature”) || “”;

  const expected = crypto
    .createHmac("sha256", process.env.NOTCHPAY_HASH_KEY)
    .update(req.body)
    .digest("hex");
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  if (!valid) {
    return res.sendStatus(403);
  }
  const event = JSON.parse(req.body.toString());
  const reference =
    event.reference ||
    event.data?.reference ||
    event.payment?.reference;
  if (!reference) {
    return res.sendStatus(400);
  }
  // Le webhook authentifie l'événement.
  // Le statut définitif sera vérifié par l'API avant
  // toute attribution des votes.
  res.sendStatus(200);
} catch (error) {
  console.error("Erreur webhook :", error.message);
  res.sendStatus(400);
}

}
);

app.get(”/api/sante”, (req, res) => {
res.json({
serveur: “OK”,
projet: “CLASSICO”,
concours: “Ballon d’Or Ngoumou 2026”
});
});

initialiser()
.then(() => {
app.listen(PORT, () => {
console.log(Serveur lancé sur le port ${PORT});
});
})
.catch(error => {
console.error(“Erreur de démarrage :”, error);
process.exit(1);
});
