const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const Node = require('../models/Node');
const Post = require('../models/Post');
const { cleanTags, slugify } = require('../services/node-rules');

async function getOrCreateBlogFolder() {
    const existing = await Node.findOne({ parentId: null, slug: 'blog' });
    if (existing) {
        if (existing.type !== 'folder') {
            throw new Error('Root slug "blog" already exists but is not a folder.');
        }
        return existing;
    }

    const lastRoot = await Node.findOne({ parentId: null })
        .sort({ order: -1 })
        .select('order')
        .lean();
    return Node.create({
        title: 'Blog',
        slug: 'blog',
        type: 'folder',
        parentId: null,
        order: lastRoot ? lastRoot.order + 1 : 0,
        isPublished: true
    });
}

function sameMigratedContent(node, post) {
    return node.title === post.title &&
        String(node.content || '') === String(post.content || '') &&
        String(node.coverImage || '') === String(post.coverImage || '');
}

async function chooseMigrationSlug(blogFolderId, post, duplicatePosition) {
    const base = slugify(post.slug || post.title) || `post-${String(post._id).slice(-6)}`;
    const preferred = duplicatePosition === 0
        ? base
        : `${base.slice(0, 173)}-${String(post._id).slice(-6)}`;

    const preferredNode = await Node.findOne({
        parentId: blogFolderId,
        slug: preferred
    });
    if (!preferredNode || sameMigratedContent(preferredNode, post)) {
        return { slug: preferred, existing: preferredNode };
    }

    const fallback = `${base.slice(0, 149)}-${String(post._id)}`;
    const fallbackNode = await Node.findOne({
        parentId: blogFolderId,
        slug: fallback
    });
    return { slug: fallback, existing: fallbackNode };
}

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is missing from backend/.env');
    }

    await mongoose.connect(process.env.MONGODB_URI);
    await Node.init();

    const blogFolder = await getOrCreateBlogFolder();
    const posts = await Post.find().sort({ createdAt: 1, _id: 1 });
    const duplicateCounts = new Map();

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (let index = 0; index < posts.length; index += 1) {
        const post = posts[index];
        try {
            const base = slugify(post.slug || post.title) || 'post';
            const position = duplicateCounts.get(base) || 0;
            duplicateCounts.set(base, position + 1);

            const { slug, existing } = await chooseMigrationSlug(
                blogFolder._id,
                post,
                position
            );
            if (existing && sameMigratedContent(existing, post)) {
                skipped += 1;
                console.log(`SKIP ${post.title} -> /blog/${existing.slug}`);
                continue;
            }
            if (existing) {
                throw new Error(`Migration slug conflict: ${slug}`);
            }

            const node = new Node({
                title: post.title,
                slug,
                type: 'page',
                parentId: blogFolder._id,
                order: index,
                content: post.content,
                coverImage: post.coverImage,
                tags: cleanTags(post.tags),
                isPublished: true,
                views: Math.max(0, Number(post.views || 0)),
                likes: 0,
                createdAt: post.createdAt,
                updatedAt: post.updatedAt
            });
            await node.save({ timestamps: false });
            migrated += 1;
            console.log(`OK   ${post.title} -> /blog/${node.slug}`);
        } catch (error) {
            failed += 1;
            console.error(`FAIL ${post.title || post._id}: ${error.message}`);
        }
    }

    console.log('');
    console.log(`Migration finished. Migrated: ${migrated}, skipped: ${skipped}, failed: ${failed}.`);
    console.log('The old posts collection was not modified.');
    await mongoose.disconnect();
    if (failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
