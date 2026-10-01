const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');
const Node = require('../models/Node');
const PageReaction = require('../models/PageReaction');
const { uploadDir } = require('../config/storage');
const { sendApiError } = require('../utils/api-error');
const { findAccessibleNodeById } = require('../services/public-node-access');
const { hashVisitorId, normalizeVisitorId } = require('../services/visitor');
const { detailProjection } = require('../services/node-rules');

function statusError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function isKnownBot(userAgent) {
    return /(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|lighthouse)/i
        .test(String(userAgent || ''));
}

async function findPublicPage(nodeId, options = {}) {
    if (!mongoose.isValidObjectId(nodeId)) return null;
    const accessible = await findAccessibleNodeById(nodeId, {
        requirePublished: true,
        session: options.session || null,
        projection: options.projection || detailProjection()
    });
    if (!accessible || accessible.node.type !== 'page') return null;
    return accessible;
}

function readVisitor(req) {
    const visitorId = normalizeVisitorId(req.get('x-visitor-id'));
    if (!visitorId) return null;
    return {
        visitorId,
        visitorHash: hashVisitorId(visitorId)
    };
}

async function reactionResponse(nodeId, visitorHash) {
    const [node, reaction] = await Promise.all([
        Node.findById(nodeId).select('likes').lean(),
        PageReaction.exists({ nodeId, visitorHash })
    ]);
    return {
        likes: Math.max(0, Number(node?.likes || 0)),
        liked: Boolean(reaction)
    };
}

async function getReactionStatus(req, res) {
    try {
        const visitor = readVisitor(req);
        if (!visitor) {
            return sendApiError(
                res,
                400,
                'INVALID_VISITOR_ID',
                'Visitor ID không hợp lệ.'
            );
        }
        const accessible = await findPublicPage(req.params.id, {
            projection: '_id type parentId title slug isPublished likes'
        });
        if (!accessible) {
            return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
        }
        return res.json(await reactionResponse(
            accessible.node._id,
            visitor.visitorHash
        ));
    } catch (error) {
        console.error('Could not load reaction status:', error);
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'Không thể tải trạng thái like.');
    }
}

async function recordView(req, res) {
    try {
        const accessible = await findPublicPage(req.params.id, {
            projection: '_id type parentId title slug isPublished views'
        });
        if (!accessible) {
            return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
        }

        if (isKnownBot(req.get('user-agent'))) {
            return res.json({ views: Math.max(0, Number(accessible.node.views || 0)) });
        }

        const updated = await Node.findOneAndUpdate(
            {
                _id: accessible.node._id,
                type: 'page',
                isPublished: true
            },
            { $inc: { views: 1 } },
            {
                returnDocument: 'after',
                projection: { views: 1 }
            }
        ).lean();
        if (!updated) {
            return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
        }
        return res.json({ views: Math.max(0, Number(updated.views || 0)) });
    } catch (error) {
        console.error('Could not record page view:', error);
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'Không thể ghi nhận lượt xem.');
    }
}

async function toggleLike(req, res) {
    const action = req.body?.action;
    if (!['like', 'unlike'].includes(action)) {
        return sendApiError(
            res,
            400,
            'INVALID_REACTION_ACTION',
            'Action phải là like hoặc unlike.'
        );
    }

    let visitor;
    try {
        visitor = readVisitor(req);
    } catch (error) {
        console.error('Visitor hashing failed:', error);
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'Like service chưa được cấu hình.');
    }
    if (!visitor) {
        return sendApiError(
            res,
            400,
            'INVALID_VISITOR_ID',
            'Visitor ID không hợp lệ.'
        );
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
        return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
    }

    const session = await mongoose.startSession();
    try {
        let response = null;
        await session.withTransaction(async () => {
            const accessible = await findPublicPage(req.params.id, {
                session,
                projection: '_id type parentId title slug isPublished likes'
            });
            if (!accessible) throw statusError(404, 'PAGE_NOT_FOUND');

            if (action === 'like') {
                const result = await PageReaction.updateOne(
                    {
                        nodeId: accessible.node._id,
                        visitorHash: visitor.visitorHash
                    },
                    {
                        $setOnInsert: {
                            nodeId: accessible.node._id,
                            visitorHash: visitor.visitorHash
                        }
                    },
                    { upsert: true, session }
                );

                if (result.upsertedCount === 1) {
                    const updated = await Node.findOneAndUpdate(
                        { _id: accessible.node._id, type: 'page' },
                        { $inc: { likes: 1 } },
                        {
                            returnDocument: 'after',
                            session,
                            projection: { likes: 1 }
                        }
                    ).lean();
                    response = {
                        likes: Math.max(0, Number(updated?.likes || 0)),
                        liked: true
                    };
                } else {
                    response = {
                        likes: Math.max(0, Number(accessible.node.likes || 0)),
                        liked: true
                    };
                }
                return;
            }

            const deleted = await PageReaction.deleteOne(
                {
                    nodeId: accessible.node._id,
                    visitorHash: visitor.visitorHash
                },
                { session }
            );
            if (deleted.deletedCount === 1) {
                await Node.updateOne(
                    {
                        _id: accessible.node._id,
                        type: 'page',
                        likes: { $gt: 0 }
                    },
                    { $inc: { likes: -1 } },
                    { session }
                );
            }
            const current = await Node.findById(accessible.node._id)
                .select('likes')
                .session(session)
                .lean();
            response = {
                likes: Math.max(0, Number(current?.likes || 0)),
                liked: false
            };
        });
        return res.json(response);
    } catch (error) {
        if (error.status === 404 || error.message === 'PAGE_NOT_FOUND') {
            return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
        }
        if (error.code === 11000 && action === 'like') {
            return res.json(await reactionResponse(
                req.params.id,
                visitor.visitorHash
            ));
        }
        console.error('Could not update page reaction:', error);
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'Không thể cập nhật lượt thích.');
    } finally {
        await session.endSession();
    }
}

async function downloadAttachment(req, res) {
    try {
        if (
            !mongoose.isValidObjectId(req.params.id) ||
            !mongoose.isValidObjectId(req.params.attachmentId)
        ) {
            return sendApiError(
                res,
                404,
                'ATTACHMENT_NOT_FOUND',
                'File đính kèm không tồn tại.'
            );
        }

        const accessible = await findAccessibleNodeById(req.params.id, {
            requirePublished: !req.user,
            projection: detailProjection()
        });
        if (!accessible || accessible.node.type !== 'page') {
            return sendApiError(res, 404, 'PAGE_NOT_FOUND', 'Page không tồn tại.');
        }

        const attachment = accessible.node.attachments.id(req.params.attachmentId);
        if (!attachment) {
            return sendApiError(
                res,
                404,
                'ATTACHMENT_NOT_FOUND',
                'File đính kèm không tồn tại.'
            );
        }
        const storedName = path.basename(String(attachment.storedName || ''));
        if (
            storedName !== attachment.storedName ||
            !/^[a-zA-Z0-9._-]+$/.test(storedName)
        ) {
            return sendApiError(
                res,
                404,
                'ATTACHMENT_NOT_FOUND',
                'File đính kèm không tồn tại.'
            );
        }

        const filePath = path.join(uploadDir, storedName);
        if (!fs.existsSync(filePath)) {
            return sendApiError(
                res,
                404,
                'ATTACHMENT_NOT_FOUND',
                'File đính kèm không tồn tại.'
            );
        }

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Content-Security-Policy', 'sandbox');
        return res.download(filePath, attachment.name);
    } catch (error) {
        console.error('Attachment download failed:', error);
        return sendApiError(res, 500, 'INTERNAL_ERROR', 'Không thể tải file.');
    }
}

module.exports = {
    downloadAttachment,
    getReactionStatus,
    recordView,
    toggleLike
};
