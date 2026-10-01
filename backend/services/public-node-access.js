const Node = require('../models/Node');
const {
    MAX_TREE_DEPTH,
    canContainChildren,
    detailProjection,
    listProjection,
    splitPublicPath
} = require('./node-rules');

function withSession(query, session) {
    return session ? query.session(session) : query;
}

async function buildBreadcrumb(node, {
    requirePublished = false,
    session = null
} = {}) {
    const breadcrumb = [];
    const seen = new Set();
    let current = node;

    for (let depth = 0; current && depth < MAX_TREE_DEPTH; depth += 1) {
        const key = String(current._id);
        if (seen.has(key)) return null;
        if (requirePublished && !current.isPublished) return null;

        seen.add(key);
        breadcrumb.unshift({
            _id: current._id,
            title: current.title,
            slug: current.slug,
            type: current.type
        });

        if (!current.parentId) return breadcrumb;
        current = await withSession(
            Node.findById(current.parentId).select(listProjection()).lean(),
            session
        );
        if (!current || !canContainChildren(current.type)) return null;
    }

    return null;
}

async function findAccessibleNodeById(nodeId, {
    requirePublished = true,
    session = null,
    projection = detailProjection()
} = {}) {
    const node = await withSession(
        Node.findById(nodeId).select(projection),
        session
    );
    if (!node) return null;

    const breadcrumb = await buildBreadcrumb(node, {
        requirePublished,
        session
    });
    if (!breadcrumb) return null;
    return { node, breadcrumb };
}

async function resolvePublicPath(pathValue) {
    const slugs = splitPublicPath(pathValue);
    const breadcrumb = [];
    let parentId = null;
    let node = null;

    for (let index = 0; index < slugs.length; index += 1) {
        node = await Node.findOne({
            parentId,
            slug: slugs[index],
            isPublished: true
        }).select(detailProjection());
        if (!node) return null;
        if (index < slugs.length - 1 && !canContainChildren(node.type)) return null;

        breadcrumb.push({
            _id: node._id,
            title: node.title,
            slug: node.slug,
            type: node.type
        });
        parentId = node._id;
    }

    return { node, breadcrumb };
}

module.exports = {
    buildBreadcrumb,
    findAccessibleNodeById,
    resolvePublicPath
};
