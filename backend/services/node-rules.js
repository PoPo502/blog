const mongoose = require('mongoose');

const MAX_TREE_DEPTH = 10;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180);
}

function cleanTags(value) {
    const tags = Array.isArray(value) ? value : [];
    return [...new Set(
        tags
            .map((tag) => String(tag).trim().toLowerCase())
            .filter(Boolean)
    )].slice(0, 12);
}

function normalizeParentId(value) {
    if (
        value === undefined ||
        value === null ||
        value === '' ||
        value === 'null'
    ) {
        return null;
    }
    if (!mongoose.isValidObjectId(value)) {
        const error = new Error('parentId is invalid.');
        error.status = 400;
        throw error;
    }
    return new mongoose.Types.ObjectId(value);
}

function normalizePublicPath(value) {
    const decoded = decodeURIComponent(String(value || '').split('?')[0]);
    const normalized = `/${decoded}`
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');
    return normalized || '/';
}

function splitPublicPath(value) {
    const normalized = normalizePublicPath(value);
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0 || parts.length > MAX_TREE_DEPTH) {
        const error = new Error('Path is invalid or exceeds the maximum tree depth.');
        error.status = 400;
        throw error;
    }
    if (parts.some((part) => !SLUG_PATTERN.test(part))) {
        const error = new Error('Path contains an invalid slug.');
        error.status = 400;
        throw error;
    }
    return parts;
}

function sameId(left, right) {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return String(left) === String(right);
}

function canContainChildren(type) {
    return type === 'folder';
}

function listProjection() {
    return '_id title slug type parentId order isPublished views likes updatedAt';
}

function detailProjection() {
    return '_id title slug type parentId order content coverImage tags isPublished views likes attachments createdAt updatedAt';
}

function serializeListNode(node, hasChildren = false) {
    return {
        _id: node._id,
        title: node.title,
        slug: node.slug,
        type: node.type,
        parentId: node.parentId || null,
        order: node.order,
        isPublished: Boolean(node.isPublished),
        hasChildren: node.type === 'folder' && Boolean(hasChildren),
        views: node.type === 'page' ? Math.max(0, Number(node.views || 0)) : 0,
        likes: node.type === 'page' ? Math.max(0, Number(node.likes || 0)) : 0,
        updatedAt: node.updatedAt || null
    };
}

module.exports = {
    MAX_TREE_DEPTH,
    SLUG_PATTERN,
    canContainChildren,
    cleanTags,
    detailProjection,
    listProjection,
    normalizeParentId,
    normalizePublicPath,
    sameId,
    serializeListNode,
    slugify,
    splitPublicPath
};
