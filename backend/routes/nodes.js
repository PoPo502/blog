const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { optionalAuthMiddleware } = require('../middleware/auth.middleware');
const {
    downloadLimiter,
    likeLimiter,
    reactionStatusLimiter,
    viewLimiter
} = require('../middleware/rate-limiters');
const {
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
} = require('../controllers/node.controller');
const {
    downloadAttachment,
    getReactionStatus,
    recordView,
    toggleLike
} = require('../controllers/reaction.controller');

const router = express.Router();

function protectDraftRequests(req, res, next) {
    if (wantsDrafts(req)) return authMiddleware(req, res, next);
    return next();
}

router.get('/by-path', resolvePath);
router.get('/legacy-by-slug', resolveLegacySlug);
router.get('/folders', authMiddleware, getFolders);
router.get('/', protectDraftRequests, getChildNodes);

router.get('/:id/reaction', reactionStatusLimiter, getReactionStatus);
router.post('/:id/view', viewLimiter, recordView);
router.post('/:id/like', likeLimiter, toggleLike);
router.get(
    '/:id/attachments/:attachmentId/download',
    optionalAuthMiddleware,
    downloadLimiter,
    downloadAttachment
);

router.get('/:id', protectDraftRequests, getNodeById);
router.post('/', authMiddleware, createNode);
router.put('/:id', authMiddleware, updateNodeHandler);
router.patch('/:id/move', authMiddleware, moveNodeHandler);
router.patch('/reorder', authMiddleware, reorderNodesHandler);
router.delete('/:id', authMiddleware, deleteNodeHandler);

module.exports = router;
