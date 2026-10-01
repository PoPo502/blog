const mongoose = require('mongoose');

const pageReactionSchema = new mongoose.Schema({
    nodeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Node',
        required: true
    },
    visitorHash: {
        type: String,
        required: true,
        trim: true,
        minlength: 64,
        maxlength: 64
    }
}, {
    timestamps: { createdAt: true, updatedAt: false }
});

pageReactionSchema.index(
    { nodeId: 1, visitorHash: 1 },
    { unique: true }
);

module.exports = mongoose.model('PageReaction', pageReactionSchema);
