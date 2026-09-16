const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_WIDTH = 1000;
const JPEG_QUALITY = 75;

router.post('/image', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file is required (field name: file)' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Uploaded file is not an image' });
  }

  try {
    const originalSize = req.file.buffer.length;
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
    const outputPath = path.join(UPLOAD_DIR, filename);

    await sharp(req.file.buffer)
      .rotate() // respects EXIF orientation
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // avoid black backgrounds on transparent PNGs
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);

    const compressedSize = fs.statSync(outputPath).size;

    res.status(201).json({
      url: `/uploads/${filename}`,
      originalSize,
      compressedSize,
      savedPercent: Math.round((1 - compressedSize / originalSize) * 100),
    });
  } catch (err) {
    res.status(400).json({ error: `Could not process image: ${err.message}` });
  }
});

module.exports = router;
