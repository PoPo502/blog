const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth.middleware');
const { loginLimiter } = require('../middleware/rate-limiters');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const password = String(req.body.password || '');

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required.' });
        }

        const user = await User.findOne({ username });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
        }

        const token = jwt.sign(
            { userId: user._id, username: user.username, role: 'admin' },
            process.env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: '24h' }
        );

        res.cookie('admin_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });

        return res.json({ username: user.username, role: 'admin' });
    } catch (err) {
        console.error('Login failed:', err);
        return res.status(500).json({ message: 'Lỗi máy chủ.' });
    }
});

router.get('/me', authMiddleware, (req, res) => {
    res.json({ username: req.user.username, role: req.user.role || 'admin' });
});

router.post('/logout', (req, res) => {
    res.clearCookie('admin_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
    });
    res.json({ message: 'Signed out.' });
});

module.exports = router;
