const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

function stripMarkdown(value = '') {
    return String(value)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#>*_~$|=-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanTags(value) {
    const tags = Array.isArray(value) ? value : [];
    return [...new Set(
        tags
            .map((tag) => String(tag).trim().toLowerCase())
            .filter(Boolean)
    )].slice(0, 12);
}

function buildPostPayload(body, partial = false) {
    const payload = {};
    const fields = ['title', 'slug', 'content', 'author', 'coverImage'];

    for (const field of fields) {
        if (!partial || Object.hasOwn(body, field)) {
            payload[field] = String(body[field] || '').trim();
        }
    }

    if (!partial || Object.hasOwn(body, 'tags')) {
        payload.tags = cleanTags(body.tags);
    }

    return payload;
}

function validatePayload(payload, partial = false) {
    const errors = [];

    if (!partial) {
        for (const field of ['title', 'slug', 'content']) {
            if (!payload[field]) errors.push(`${field} is required`);
        }
    }

    if (payload.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug)) {
        errors.push('slug must contain lowercase letters, numbers and hyphens only');
    }
    if (payload.title && payload.title.length > 200) errors.push('title is too long');
    if (payload.content && payload.content.length > 2_000_000) errors.push('content is too large');
    if (payload.author && payload.author.length > 80) errors.push('author is too long');

    return errors;
}

router.get('/', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database unavailable.' });
        }

        const posts = await Post.find().sort({ createdAt: -1 }).lean();
        return res.json(posts.map(({ content, ...post }) => ({
            ...post,
            excerpt: stripMarkdown(content).slice(0, 240)
        })));
    } catch (err) {
        return res.status(500).json({ message: 'Could not load posts.' });
    }
});

router.get('/:slug', async (req, res) => {
    try {
        const post = await Post.findOneAndUpdate(
            { slug: req.params.slug },
            { $inc: { views: 1 } },
            { returnDocument: 'after', timestamps: false }
        );

        if (!post) {
            return res.status(404).json({ message: 'Post not found.' });
        }

        return res.json(post);
    } catch (err) {
        return res.status(500).json({ message: 'Could not load this post.' });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    const payload = buildPostPayload(req.body);
    const errors = validatePayload(payload);

    if (errors.length > 0) {
        return res.status(400).json({ message: errors.join('. ') });
    }

    try {
        const newPost = await Post.create(payload);
        return res.status(201).json(newPost);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Slug already exists.' });
        }
        return res.status(400).json({ message: 'Could not create post.' });
    }
});

router.patch('/:id', authMiddleware, async (req, res) => {
    const payload = buildPostPayload(req.body, true);
    const errors = validatePayload(payload, true);

    if (errors.length > 0) {
        return res.status(400).json({ message: errors.join('. ') });
    }

    try {
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            { $set: payload },
            { returnDocument: 'after', runValidators: true }
        );

        if (!post) {
            return res.status(404).json({ message: 'Post not found.' });
        }

        return res.json(post);
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Slug already exists.' });
        }
        return res.status(400).json({ message: 'Could not update post.' });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const post = await Post.findByIdAndDelete(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found.' });
        }
        return res.json({ message: 'Post deleted successfully.' });
    } catch (err) {
        return res.status(400).json({ message: 'Could not delete post.' });
    }
});

module.exports = router;
