const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        maxlength: 180,
        match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },
    content: { type: String, required: true, maxlength: 2_000_000 },
    author: { type: String, default: 'Admin', trim: true, maxlength: 80 },
    tags: [{ type: String, trim: true, maxlength: 40 }],
    coverImage: { type: String, trim: true, maxlength: 500 },
    views: { type: Number, default: 0 }
}, {
    timestamps: true
});

module.exports = mongoose.model('Post', postSchema);
