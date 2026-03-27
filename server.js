const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const Database = require("better-sqlite3");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database("data.db");

// ---- CONFIG ----
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
const BASE_URL = "https://api.rentcast.io/v1/listings";

// default query (you can override via UI later)
let config = {
  zip: "11215",
  minRent: 2500,
  maxRent: 6500,
  centerLat: 40.658249173169104,
  centerLng: -73.98223774928385,
  radiusKm: 15
};

// ---- DB SETUP ----
db.prepare(`
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  price INTEGER,
  lat REAL,
  lng REAL,
  address TEXT,
  data TEXT
)
`).run();

// ---- DISTANCE ----
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI/180;
  const dLon = (lon2 - lon1) * Math.PI/180;

  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLon/2)**2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---- FETCH + CACHE ----
async function fetchListings() {
  console.log("Fetching listings...");

  try {
    console.log("Making API request with params:", {
      zipCode: config.zip,
      price: `${config.minRent}:${config.maxRent}`,
      limit: 50
    });

    const res = await axios.get("https://api.rentcast.io/v1/listings/rental/long-term", {
        headers: {
            "X-Api-Key": RENTCAST_API_KEY
        },
        params: {
            zipCode: config.zip,
            price: `${config.minRent}:${config.maxRent}`,
            limit: 50
        }
    });

    console.log("API Response status:", res.status);
    console.log("RAW RESPONSE COUNT:", res.data.length);
    console.log("SAMPLE:", res.data[0]);

    const listings = res.data;

    const insert = db.prepare(`
      INSERT OR REPLACE INTO listings
      (id, price, lat, lng, address, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const l of listings) {
      if (!l.latitude || !l.longitude) continue;

      const dist = haversine(
        config.centerLat,
        config.centerLng,
        l.latitude,
        l.longitude
      );

      if (dist <= config.radiusKm) {
        insert.run(
          l.id,
          l.price,
          l.latitude,
          l.longitude,
          l.formattedAddress,
          JSON.stringify(l)
        );
      }
    }

    console.log("Listings updated.");
  } catch (e) {
    console.error("Fetch error:", e.message);
    if (e.response) {
      console.error("Response status:", e.response.status);
      console.error("Response data:", e.response.data);
    }
  }
}

// ---- CRON DISABLED ----
// Cron job disabled - using manual refresh button instead

// ---- API ----

// get listings
app.get("/listings", (req, res) => {
  const rows = db.prepare("SELECT * FROM listings").all();
  res.json(rows.map(r => JSON.parse(r.data)));
});

// update config
app.post("/config", (req, res) => {
  config = { ...config, ...req.body };
  res.json({ success: true, config });
});

// manual refresh
app.post("/refresh", async (req, res) => {
  await fetchListings();
  res.json({ success: true });
});

// ---- START ----
app.listen(3000, () => {
  console.log("Server running on port 3000");
  console.log("Use POST /refresh to fetch new listings");
});