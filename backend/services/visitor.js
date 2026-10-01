const crypto = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeVisitorId(value) {
    const visitorId = String(value || '').trim().toLowerCase();
    return UUID_PATTERN.test(visitorId) ? visitorId : null;
}

function hashVisitorId(visitorId) {
    const secret = process.env.VISITOR_HASH_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('VISITOR_HASH_SECRET is not configured.');
    return crypto
        .createHmac('sha256', secret)
        .update(visitorId)
        .digest('hex');
}

module.exports = {
    UUID_PATTERN,
    hashVisitorId,
    normalizeVisitorId
};
