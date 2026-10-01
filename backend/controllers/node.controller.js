const mongoose = require('mongoose');
const Node = require('../models/Node');
const Post = require('../models/Post');
const {
    buildBreadcrumb,
    findAccessibleNodeById,
    resolvePublicPath
} = require('../services/public-node-access');
const {
    MAX_TREE_DEPTH,
    canContainChildren,
    cleanTags,
    detailProjection,
    listProjection,
    normalizeParentId,
    sameId,
    serializeListNode,
    slugify
} = require('../services/node-rules');

function wantsDrafts(req) {
    return req.query.includeDrafts === '1' || req.query.includeDrafts === 'true';
}

function statusError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function parseOrder(value, fallback = 0) {
    const order = Number(value);
    if (!Number.isInteger(order) || order < 0 || order > 1_000_000) {
        throw statusError(400, 'Order must be a non-negative integer.');
    }
    return order ?? fallback;
}

async function getNextOrder(parentId) {
    const lastNode = await Node.findOne({ parentId })
        .sort({ order: -1 })
        .select('order')
        .lean();
    return lastNode ? lastNode.order + 1 : 0;
}

async function ensureUniqueSiblingSlug(parentId, slug, excludedId = null) {
    const query = { parentId, slug };
    if (excludedId) query._id = { $ne: excludedId };
    if (await Node.exists(query)) {
        throw statusError(409, 'Slug already exists inside this folder.');
    }
}

async function getFolderParent(parentId) {
    if (!parentId) return null;
    const parent = await Node.findById(parentId).select(listProjection());
    if (!parent) throw statusError(400, 'Parent folder does not exist.');
    if (!canContainChildren(parent.type)) {
        throw statusError(409, 'A page cannot contain child nodes.');
    }
    return parent;
}

async function validateParentChain(parentId, movingNodeId = null) {
    if (!parentId) return;

    const seen = new Set();
    let currentId = parentId;
    let depth = 1;

    while (currentId) {
        const key = String(currentId);
        if (seen.has(key)) throw statusError(409, 'The existing tree contains a cycle.');
        if (movingNodeId && sameId(currentId, movingNodeId)) {
            throw statusError(409, 'A folder cannot be moved into itself or its descendant.');
        }
        if (depth >= MAX_TREE_DEPTH) {
            throw statusError(400, `The tree is limited to ${MAX_TREE_DEPTH} levels.`);
        }

        seen.add(key);
        const current = await Node.findById(currentId).select('parentId type').lean();
        if (!current) throw statusError(400, 'Parent chain contains a missing node.');
        if (!canContainChildren(current.type)) {
            throw statusError(409, 'A page cannot contain child nodes.');
        }
        currentId = current.parentId;
        depth += 1;
    }
}

async function listChildren(parentId, includeDrafts) {
    if (parentId) {
        const parent = await Node.findById(parentId).select(listProjection()).lean();
        const breadcrumb = parent
            ? await buildBreadcrumb(parent, { requirePublished: !includeDrafts })
            : null;
        if (!parent || !canContainChildren(parent.type) || !breadcrumb) {
            throw statusError(404, 'Folder not found.');
        }
    }

    const query = { parentId };
    if (!includeDrafts) query.isPublished = true;
    const nodes = await Node.find(query)
        .select(listProjection())
        .sort({ order: 1, title: 1 })
        .lean();

    const folderIds = nodes
        .filter((node) => node.type === 'folder')
        .map((node) => node._id);
    const childQuery = { parentId: { $in: folderIds } };
    if (!includeDrafts) childQuery.isPublished = true;
    const parentsWithChildren = folderIds.length > 0
        ? await Node.distinct('parentId', childQuery)
        : [];
    const childSet = new Set(parentsWithChildren.map(String));

    return nodes.map((node) => serializeListNode(node, childSet.has(String(node._id))));
}

function serializeDetail(node, breadcrumb) {
    const base = {
        _id: node._id,
        title: node.title,
        slug: node.slug,
        type: node.type,
        parentId: node.parentId || null,
        order: node.order,
        isPublished: Boolean(node.isPublished),
        views: node.type === 'page' ? Math.max(0, Number(node.views || 0)) : 0,
        likes: node.type === 'page' ? Math.max(0, Number(node.likes || 0)) : 0,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        breadcrumb
    };
    if (node.type === 'page') {
        base.content = node.content || '';
        base.coverImage = node.coverImage || '';
        base.tags = node.tags || [];
        base.attachments = (node.attachments || []).map((attachment) => ({
            _id: attachment._id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            createdAt: attachment.createdAt,
            url: `/api/nodes/${node._id}/attachments/${attachment._id}/download`
        }));
    }
    return base;
}

async function updateNode(node, body) {
    if (Object.hasOwn(body, 'type') && body.type !== node.type) {
        throw statusError(400, 'Node type cannot be changed after creation.');
    }

    const nextParentId = Object.hasOwn(body, 'parentId')
        ? normalizeParentId(body.parentId)
        : node.parentId;
    if (node.type === 'page' && !nextParentId) {
        throw statusError(400, 'A page must belong to a folder.');
    }

    await getFolderParent(nextParentId);
    await validateParentChain(nextParentId, node.type === 'folder' ? node._id : null);

    const title = Object.hasOwn(body, 'title')
        ? String(body.title || '').trim()
        : node.title;
    const slug = Object.hasOwn(body, 'slug')
        ? slugify(body.slug)
        : node.slug;
    if (!title) throw statusError(400, 'Title is required.');
    if (!slug) throw statusError(400, 'Slug is required.');

    await ensureUniqueSiblingSlug(nextParentId, slug, node._id);
    node.title = title;
    node.slug = slug;
    node.parentId = nextParentId;

    if (Object.hasOwn(body, 'order')) node.order = parseOrder(body.order);
    if (Object.hasOwn(body, 'isPublished')) {
        node.isPublished = body.isPublished === true || body.isPublished === 'true';
    }
    if (node.type === 'page') {
        if (Object.hasOwn(body, 'content')) node.content = String(body.content || '');
        if (Object.hasOwn(body, 'coverImage')) {
            node.coverImage = String(body.coverImage || '').trim();
        }
        if (Object.hasOwn(body, 'tags')) node.tags = cleanTags(body.tags);
    }

    await node.save();
    return node;
}

async function resolvePath(req, res) {
    try {
        const resolved = await resolvePublicPath(req.query.path);
        if (!resolved) return res.status(404).json({ message: 'Node not found.' });
        return res.json(serializeDetail(resolved.node, resolved.breadcrumb));
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.status ? error.message : 'Could not resolve this path.'
        });
    }
}

async function resolveLegacySlug(req, res) {
    try {
        const requestedSlug = String(req.query.slug || '').trim().toLowerCase();
        const normalizedSlug = slugify(requestedSlug);
        if (!normalizedSlug) return res.status(404).json({ message: 'Migrated page not found.' });

        const blogFolder = await Node.findOne({
            parentId: null,
            slug: 'blog',
            type: 'folder',
            isPublished: true
        }).select(detailProjection());
        if (!blogFolder) return res.status(404).json({ message: 'Migrated page not found.' });

        let page = await Node.findOne({
            parentId: blogFolder._id,
            slug: normalizedSlug,
            type: 'page',
            isPublished: true
        }).select(detailProjection());

        if (!page) {
            const legacyPost = await Post.findOne({ slug: requestedSlug }).select('_id title').lean();
            if (legacyPost) {
                page = await Node.findOne({
                    parentId: blogFolder._id,
                    slug: `${normalizedSlug}-${String(legacyPost._id).slice(-6)}`,
                    type: 'page',
                    isPublished: true
                }).select(detailProjection());
            }
        }

        if (!page) return res.status(404).json({ message: 'Migrated page not found.' });
        return res.json({ path: `/blog/${page.slug}` });
    } catch (error) {
        return res.status(500).json({ message: 'Could not resolve legacy URL.' });
    }
}

async function getFolders(req, res) {
    try {
        const folders = await Node.find({ type: 'folder' })
            .select(listProjection())
            .sort({ title: 1 })
            .lean();
        return res.json(folders.map((folder) => serializeListNode(folder, false)));
    } catch (error) {
        return res.status(500).json({ message: 'Could not load folders.' });
    }
}

async function getChildNodes(req, res) {
    try {
        const parentId = normalizeParentId(req.query.parentId);
        return res.json(await listChildren(parentId, wantsDrafts(req)));
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.status ? error.message : 'Could not load child nodes.'
        });
    }
}

async function getNodeById(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Node id is invalid.' });
        }
        const accessible = await findAccessibleNodeById(req.params.id, {
            requirePublished: !wantsDrafts(req),
            projection: detailProjection()
        });
        if (!accessible) return res.status(404).json({ message: 'Node not found.' });
        return res.json(serializeDetail(accessible.node, accessible.breadcrumb));
    } catch (error) {
        return res.status(500).json({ message: 'Could not load node.' });
    }
}

async function createNode(req, res) {
    try {
        const title = String(req.body.title || '').trim();
        const type = req.body.type;
        const parentId = normalizeParentId(req.body.parentId);
        if (!title) throw statusError(400, 'Title is required.');
        if (!['folder', 'page'].includes(type)) {
            throw statusError(400, 'Type must be folder or page.');
        }
        if (type === 'page' && !parentId) {
            throw statusError(400, 'A page must belong to a folder.');
        }

        await getFolderParent(parentId);
        await validateParentChain(parentId);
        const slug = slugify(req.body.slug || title);
        if (!slug) throw statusError(400, 'Could not generate a valid slug.');
        await ensureUniqueSiblingSlug(parentId, slug);

        const order = Object.hasOwn(req.body, 'order')
            ? parseOrder(req.body.order)
            : await getNextOrder(parentId);
        const payload = {
            title,
            slug,
            type,
            parentId,
            order,
            isPublished: req.body.isPublished === true || req.body.isPublished === 'true'
        };
        if (type === 'page') {
            payload.content = String(req.body.content || '');
            payload.coverImage = String(req.body.coverImage || '').trim();
            payload.tags = cleanTags(req.body.tags);
        }

        const node = await Node.create(payload);
        const breadcrumb = await buildBreadcrumb(node, { requirePublished: false });
        return res.status(201).json(serializeDetail(node, breadcrumb));
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Slug already exists inside this folder.' });
        }
        return res.status(error.status || 400).json({
            message: error.message || 'Could not create node.'
        });
    }
}

async function updateNodeHandler(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Node id is invalid.' });
        }
        const node = await Node.findById(req.params.id);
        if (!node) return res.status(404).json({ message: 'Node not found.' });
        const updated = await updateNode(node, req.body);
        const breadcrumb = await buildBreadcrumb(updated, { requirePublished: false });
        return res.json(serializeDetail(updated, breadcrumb));
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Slug already exists inside this folder.' });
        }
        return res.status(error.status || 400).json({
            message: error.message || 'Could not update node.'
        });
    }
}

async function moveNodeHandler(req, res) {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Node id is invalid.' });
        }
        const node = await Node.findById(req.params.id);
        if (!node) return res.status(404).json({ message: 'Node not found.' });

        const payload = {};
        if (Object.hasOwn(req.body, 'parentId')) payload.parentId = req.body.parentId;
        if (Object.hasOwn(req.body, 'order')) payload.order = req.body.order;
        const updated = await updateNode(node, payload);
        const breadcrumb = await buildBreadcrumb(updated, { requirePublished: false });
        return res.json(serializeDetail(updated, breadcrumb));
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Slug already exists at the destination.' });
        }
        return res.status(error.status || 400).json({
            message: error.message || 'Could not move node.'
        });
    }
}

async function reorderNodesHandler(req, res) {
    try {
        const parentId = normalizeParentId(req.body.parentId);
        const items = Array.isArray(req.body.items) ? req.body.items : [];
        if (items.length === 0 || items.length > 500) {
            return res.status(400).json({ message: 'items must contain 1 to 500 nodes.' });
        }

        const ids = items.map((item) => item.id);
        if (
            new Set(ids.map(String)).size !== ids.length ||
            ids.some((id) => !mongoose.isValidObjectId(id))
        ) {
            return res.status(400).json({ message: 'items contain invalid or duplicate ids.' });
        }

        const nodes = await Node.find({ _id: { $in: ids } }).select('parentId');
        if (
            nodes.length !== ids.length ||
            nodes.some((node) => !sameId(node.parentId, parentId))
        ) {
            return res.status(400).json({
                message: 'All reordered nodes must belong to the same folder.'
            });
        }

        await Node.bulkWrite(items.map((item, index) => ({
            updateOne: {
                filter: { _id: item.id },
                update: { $set: { order: index } }
            }
        })));
        return res.json(await listChildren(parentId, true));
    } catch (error) {
        return res.status(error.status || 500).json({
            message: error.status ? error.message : 'Could not reorder nodes.'
        });
    }
}

async function deleteNodeHandler(req, res) {
    const fs = require('fs');
    const path = require('path');
    const PageReaction = require('../models/PageReaction');
    const { uploadDir } = require('../config/storage');

    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Node id is invalid.' });
        }
        const node = await Node.findById(req.params.id);
        if (!node) return res.status(404).json({ message: 'Node not found.' });

        if (await Node.exists({ parentId: node._id })) {
            return res.status(409).json({
                message: 'This folder still has children. Move or delete them first.'
            });
        }
        const storedNames = node.type === 'page'
            ? (node.attachments || []).map((attachment) => attachment.storedName)
            : [];
        await node.deleteOne();
        await PageReaction.deleteMany({ nodeId: node._id });
        await Promise.all(storedNames.map(async (storedName) => {
            const filename = path.basename(String(storedName || ''));
            if (filename !== storedName || !/^[a-zA-Z0-9._-]+$/.test(filename)) return;
            await fs.promises.unlink(path.join(uploadDir, filename)).catch(() => {});
        }));
        return res.json({ message: 'Node deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ message: 'Could not delete node.' });
    }
}

module.exports = {
    createNode,
    deleteNodeHandler,
    getChildNodes,
    getFolders,
    getNodeById,
    moveNodeHandler,
    reorderNodesHandler,
    resolveLegacySlug,
    resolvePath,
    updateNodeHandler,
    wantsDrafts
};
