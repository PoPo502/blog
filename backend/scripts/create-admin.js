const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');

async function main() {
    const username = String(process.argv[2] || '').trim();
    const password = String(process.argv[3] || '');

    if (!username || password.length < 12) {
        console.error('Usage: npm run create-admin -- <username> <password-with-at-least-12-characters>');
        process.exit(1);
    }

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is missing from backend/.env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const existingUser = await User.findOne();
    if (existingUser) {
        existingUser.username = username;
        existingUser.password = password;
        await existingUser.save();
        console.log(`Updated the single admin account: ${username}`);
    } else {
        await User.create({ username, password });
        console.log(`Created the single admin account: ${username}`);
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
