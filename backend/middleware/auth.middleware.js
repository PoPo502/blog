const jwt = require('jsonwebtoken');

function readToken(req) {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;
    return req.cookies?.admin_session || bearerToken;
}

function authMiddleware(req, res, next) {
    const token = readToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Authentication required.' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
        });
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired session.' });
    }
}

function optionalAuthMiddleware(req, res, next) {
    const token = readToken(req);
    if (!token) return next();

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
        });
    } catch {
        req.user = null;
    }
    return next();
}

module.exports = authMiddleware;
module.exports.optionalAuthMiddleware = optionalAuthMiddleware;
