const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/auth.middleware');
const { uploadLimiter } = require('../middleware/rate-limiters');
const Node = require('../models/Node');
const { uploadDir } = require('../config/storage');

const router = express.Router();

fs.mkdirSync(uploadDir, { recursive: true });

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const imageMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);
const attachmentTypes = new Map([
    ['.pdf', new Set(['application/pdf'])],
    ['.zip', new Set([
        'application/zip',
        'application/x-zip-compressed',
        'application/octet-stream'
    ])],
    ['.json', new Set(['application/json', 'text/plain'])],
    ['.txt', new Set(['text/plain', 'application/octet-stream'])],
    ['.log', new Set(['text/plain', 'application/octet-stream'])],
    ['.md', new Set(['text/plain', 'application/octet-stream'])],
    ['.pcap', new Set(['application/vnd.tcpdump.pcap', 'application/octet-stream'])],
    ['.cap', new Set(['application/vnd.tcpdump.pcap', 'application/octet-stream'])],
    ['.pcapng', new Set(['application/vnd.tcpdump.pcap', 'application/octet-stream'])]
]);

function readLimit(name, fallback, maximum) {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || value <= 0 || value > maximum) return fallback;
    return value;
}

const imageMaxBytes = readLimit('UPLOAD_IMAGE_MAX_MB', 5, 25) * 1024 * 1024;
const fileMaxBytes = readLimit('UPLOAD_FILE_MAX_MB', 50, 250) * 1024 * 1024;
function safeDisplayName(value, fallback = 'download') {
    const name = path.basename(String(value || ''))
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return name || fallback;
}

function isAllowedImage(filename, mimeType) {
    return imageExtensions.has(path.extname(filename).toLowerCase()) &&
        imageMimeTypes.has(mimeType);
}

function isAllowedAttachment(filename, mimeType) {
    const allowedMimeTypes = attachmentTypes.get(path.extname(filename).toLowerCase());
    return Boolean(allowedMimeTypes?.has(mimeType));
}

const storage = multer.diskStorage({
    destination(req, file, callback) {
        callback(null, uploadDir);
    },
    filename(req, file, callback) {
        const extension = path.extname(file.originalname).toLowerCase().slice(0, 12);
        callback(null, `${crypto.randomUUID()}${extension}`);
    }
});

const coverUpload = multer({
    storage,
    limits: { fileSize: imageMaxBytes, files: 1 },
    fileFilter(req, file, callback) {
        if (!isAllowedImage(file.originalname, file.mimetype)) {
            return callback(Object.assign(
                new Error('Cover must be a JPEG, PNG, WebP or GIF image.'),
                { status: 415 }
            ));
        }
        return callback(null, true);
    }
});

const attachmentUpload = multer({
    storage,
    limits: { fileSize: fileMaxBytes, files: 1 },
    fileFilter(req, file, callback) {
        if (!isAllowedAttachment(file.originalname, file.mimetype)) {
            return callback(Object.assign(
                new Error('This attachment type is not allowed.'),
                { status: 415 }
            ));
        }
        return callback(null, true);
    }
});

function imageResponse(req, res) {
    if (!req.file) {
        return res.status(400).json({ message: 'No image uploaded.' });
    }

    return res.json({
        url: `/uploads/${encodeURIComponent(req.file.filename)}`,
        name: safeDisplayName(req.file.originalname, 'image'),
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size
    });
}

router.post(
    '/cover',
    authMiddleware,
    uploadLimiter,
    coverUpload.single('image'),
    imageResponse
);

router.post(
    '/image',
    authMiddleware,
    uploadLimiter,
    coverUpload.single('image'),
    imageResponse
);

router.post('/attachment', authMiddleware, uploadLimiter, attachmentUpload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    try {
        if (!mongoose.isValidObjectId(req.body.nodeId)) {
            await fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({
                message: 'A valid page nodeId is required.'
            });
        }
        const node = await Node.findById(req.body.nodeId);
        if (!node || node.type !== 'page') {
            await fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({
                message: 'Attachment must belong to an existing page.'
            });
        }

        const attachment = {
            name: safeDisplayName(req.file.originalname),
            storedName: req.file.filename,
            mimeType: req.file.mimetype,
            size: req.file.size
        };
        node.attachments.push(attachment);
        await node.save();
        const saved = node.attachments[node.attachments.length - 1];

        return res.json({
            _id: saved._id,
            url: `/api/nodes/${node._id}/attachments/${saved._id}/download`,
            name: saved.name,
            storedName: saved.storedName,
            mimeType: saved.mimeType,
            size: saved.size,
            createdAt: saved.createdAt
        });
    } catch (error) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        console.error('Attachment upload failed:', error);
        return res.status(500).json({ message: 'Could not attach this file to the page.' });
    }
});

router.get('/files/:filename', authMiddleware, (req, res) => {
    const filename = path.basename(req.params.filename);
    if (filename !== req.params.filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
        return res.status(400).json({ message: 'Invalid filename.' });
    }

    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'File not found.' });
    }

    const requestedName = safeDisplayName(req.query.name, filename);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', 'sandbox');
    return res.download(filePath, requestedName);
});

module.exports = router;
module.exports._test = {
    isAllowedAttachment,
    isAllowedImage,
    safeDisplayName
};
