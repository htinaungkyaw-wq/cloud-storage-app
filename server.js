import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import Database from 'better-sqlite3';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

// Setup Local SQLite Database
const db = new Database('database.sqlite');
db.prepare(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    size_display TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    url TEXT NOT NULL,
    public_id TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`).run();

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// GET all files
app.get('/api/files', (req, res) => {
  try {
    const files = db.prepare('SELECT * FROM files ORDER BY uploaded_at DESC;').all();
    const totalRow = db.prepare('SELECT SUM(size_bytes) as total FROM files;').get();
    const totalUsedBytes = totalRow.total || 0;
    res.json({ files, totalUsedBytes });
  } catch (error) {
    console.error("GET Files Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// UPLOAD file
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'cloud_storage_app' },
      (error, cloudinaryResult) => {
        if (error) {
          console.error("Cloudinary Upload Error Details:", error);
          return res.status(500).json({ error: error.message });
        }

        try {
          const name = req.file.originalname;
          const sizeBytes = req.file.size;
          const sizeDisplay = formatBytes(sizeBytes);
          const url = cloudinaryResult.secure_url;
          const publicId = cloudinaryResult.public_id;

          const stmt = db.prepare(`
            INSERT INTO files (name, size_display, size_bytes, url, public_id) 
            VALUES (?, ?, ?, ?, ?);
          `);
          const info = stmt.run(name, sizeDisplay, sizeBytes, url, publicId);

          res.status(201).json({ success: true, id: info.lastInsertRowid });
        } catch (dbError) {
          console.error("Database Insert Error:", dbError);
          res.status(500).json({ error: dbError.message });
        }
      }
    );

    uploadStream.end(req.file.buffer);
  } catch (error) {
    console.error("Server Catch Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE file
app.delete('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fileRow = db.prepare('SELECT public_id FROM files WHERE id = ?;').get(id);

    if (fileRow) {
      await cloudinary.uploader.destroy(fileRow.public_id);
      db.prepare('DELETE FROM files WHERE id = ?;').run(id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));