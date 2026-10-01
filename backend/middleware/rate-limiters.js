const rateLimit = require('express-rate-limit');
const { sendApiError } = require('../utils/api-error');

function limiter(limit, code = 'RATE_LIMITED', windowMs = 15 * 60 * 1000) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler(req, res) {
            return sendApiError(
                res,
                429,
                code,
                'Bạn thao tác quá nhanh. Vui lòng thử lại sau.'
            );
        }
    });
}

const loginLimiter = limiter(10, 'LOGIN_RATE_LIMITED');
const uploadLimiter = limiter(40, 'UPLOAD_RATE_LIMITED');
const viewLimiter = limiter(60);
const likeLimiter = limiter(30);
const reactionStatusLimiter = limiter(120);
const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip(req) {
        return Boolean(req.user);
    },
    handler(req, res) {
        return sendApiError(
            res,
            429,
            'RATE_LIMITED',
            'Có quá nhiều lượt tải file. Vui lòng thử lại sau.'
        );
    }
});

module.exports = {
    downloadLimiter,
    likeLimiter,
    loginLimiter,
    reactionStatusLimiter,
    uploadLimiter,
    viewLimiter
};
