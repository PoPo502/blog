const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 180
    },
    storedName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 220,
        match: /^[a-zA-Z0-9._-]+$/
    },
    mimeType: {
        type: String,
        required: true,
        trim: true,
        maxlength: 150
    },
    size: {
        type: Number,
        required: true,
        min: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const nodeSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    slug: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        maxlength: 180,
        match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },
    type: {
        type: String,
        enum: ['folder', 'page'],
        required: true
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node',
        default: null
    },
    order: {
        type: Number,
        default: 0,
        min: 0
    },
    content: {
        type: String,
        default: '',
        maxlength: 2_000_000
    },
    coverImage: {
        type: String,
        trim: true,
        maxlength: 500
    },
    tags: [{
        type: String,
        trim: true,
        maxlength: 40
    }],
    isPublished: {
        type: Boolean,
        default: false
    },
    views: {
        type: Number,
        default: 0,
        min: 0
    },
    likes: {
        type: Number,
        default: 0,
        min: 0
    },
    attachments: {
        type: [attachmentSchema],
        default: []
    }
}, {
    timestamps: true
});

nodeSchema.index({ parentId: 1, order: 1 });
nodeSchema.index({ parentId: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('Node', nodeSchema);
