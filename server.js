import express from "express";
import multer from "multer";
import mysql from "mysql2/promise";
import path from "path";
import fs from "fs/promises";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

dotenv.config();

const app = express();

// =========================
// SECURITY + CORS
// =========================
app.use(helmet());
app.use(
  cors({
    origin: [
      "https://frontend_url.com",
      "http://127.0.0.1:5500/Project/public/index.html",
      process.env.FRONTEND_URL,
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// FOLDERS (local only)
// =========================
const uploadDir = "uploads";
const publicDir = "public";

async function ensureDirectories() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
    console.log("📁 Uploads & public folders ready.");
  } catch (err) {
    console.error("❌ Failed to create directories:", err);
  }
}

// =========================
// STATIC FILES
// =========================
app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadDir));

// =========================
// MYSQL POOL
// =========================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``,
    );

    await connection.query(`USE \`${process.env.DB_NAME}\``);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS BlogPosts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        Title VARCHAR(255) NOT NULL,
        Content TEXT NOT NULL,
        Image_URL VARCHAR(500),
        Audio_URL VARCHAR(500),
        Video_URL VARCHAR(500),
        Date_Posted TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    connection.release();
    console.log("✅ Database initialized.");
  } catch (err) {
    console.error("❌ Database setup failed:", err);
    process.exit(1);
  }
}

// =========================
// MULTER – local disk only for now
// =========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir + "/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB maximum
    fields: 10,
    parts: 20,
  },
  fileFilter: (req, file, cb) => {
    const allowed = {
      image: ["image/jpeg", "image/png"],
      audio: ["audio/mpeg", "audio/mp3", "audio/m4a"],
      video: ["video/mp4"],
    };

    const isAllowed =
      (file.fieldname === "image" && allowed.image.includes(file.mimetype)) ||
      (file.fieldname === "audio" && allowed.audio.includes(file.mimetype)) ||
      (file.fieldname === "video" && allowed.video.includes(file.mimetype));

    cb(null, isAllowed);
  },
});

// =========================
// ROUTES
// =========================

// GET all posts
app.get("/posts", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM BlogPosts ORDER BY Date_Posted DESC",
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// CREATE post
app.post(
  "/posts",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { title, content } = req.body;

      if (!title?.trim() || !content?.trim()) {
        return res
          .status(400)
          .json({ error: "Title and content are required" });
      }

      if (title.length > 255) {
        return res.status(400).json({ error: "Title too long!" });
      }

      let Image_URL = null;
      let Audio_URL = null;
      let Video_URL = null;

      if (req.files?.image?.[0]) {
        Image_URL = `${uploadDir}/${req.files.image[0].filename}`;
      }
      if (req.files?.audio?.[0]) {
        Audio_URL = `${uploadDir}/${req.files.audio[0].filename}`;
      }
      if (req.files?.video?.[0]) {
        Video_URL = `${uploadDir}/${req.files.video[0].filename}`;
      }

      const [result] = await pool.query(
        `INSERT INTO BlogPosts 
         (Title, Content, Image_URL, Audio_URL, Video_URL) 
         VALUES (?, ?, ?, ?, ?)`,
        [title.trim(), content.trim(), Image_URL, Audio_URL, Video_URL],
      );

      const [newPost] = await pool.query(
        "SELECT * FROM BlogPosts WHERE id = ?",
        [result.insertId],
      );

      res.status(201).json(newPost[0] || { message: "Post created" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || "Server error" });
    }
  },
);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(400).json({ error: err.message || "Invalid request" });
});

// =========================
// START
// =========================
const PORT = process.env.PORT || 3000;

(async () => {
  await ensureDirectories();
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Server running → http://localhost:${PORT}`);
  });
})();
