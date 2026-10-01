const crypto = require('crypto');
const dotenv = require('dotenv');
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');

dotenv.config();

const Node = require('../models/Node');
const { uploadDir } = require('../config/storage');
const { slugify } = require('../services/node-rules');

function printUsage() {
    console.log(`
Usage:
  npm run import-notion -- <path-to-notion-export-file-or-folder> [--parent-id <id>] [--parent-path <path>] [--apply]

Examples:
  # Preview (Dry run) importing a single Notion Markdown file into root folder 'Blog'
  npm run import-notion -- "./tmp/My_Notion_Page.md"

  # Apply import into database
  npm run import-notion -- "./tmp/My_Notion_Page.md" --apply

  # Import into a specific folder path (e.g., /blog/portswigger)
  npm run import-notion -- "./tmp/My_Notion_Page.md" --parent-path "/blog/portswigger" --apply
`);
}

function safeDisplayName(value, fallback = 'image') {
    const name = path.basename(String(value || ''))
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return name || fallback;
}

async function resolveParentNode(parentIdArg, parentPathArg) {
    if (parentIdArg) {
        if (!mongoose.isValidObjectId(parentIdArg)) {
            throw new Error(`Parent ID '${parentIdArg}' không hợp lệ.`);
        }
        const parent = await Node.findById(parentIdArg);
        if (!parent || parent.type !== 'folder') {
            throw new Error(`Folder với ID '${parentIdArg}' không tồn tại.`);
        }
        return parent;
    }

    if (parentPathArg) {
        const segments = parentPathArg.split('/').map((s) => s.trim()).filter(Boolean);
        let currentParentId = null;
        let lastFolder = null;

        for (const segment of segments) {
            const slug = slugify(segment);
            let folder = await Node.findOne({ parentId: currentParentId, slug, type: 'folder' });
            if (!folder) {
                folder = await Node.create({
                    title: segment,
                    slug,
                    type: 'folder',
                    parentId: currentParentId,
                    isPublished: true
                });
            }
            currentParentId = folder._id;
            lastFolder = folder;
        }
        return lastFolder;
    }

    // Default: find or create root 'Blog' folder
    let rootBlog = await Node.findOne({ parentId: null, slug: 'blog', type: 'folder' });
    if (!rootBlog) {
        rootBlog = await Node.create({
            title: 'Blog',
            slug: 'blog',
            type: 'folder',
            parentId: null,
            isPublished: true
        });
    }
    return rootBlog;
}

function processNotionMarkdown(content, fileDir, isApply) {
    fs.mkdirSync(uploadDir, { recursive: true });

    let updatedContent = content;
    const imageRegex = /!\[(.*?)\]\((.*?)\)/g;
    let match;

    const uploadedImages = [];

    while ((match = imageRegex.exec(content)) !== null) {
        const altText = match[1];
        const rawImagePath = decodeURIComponent(match[2]);

        // Skip remote web URLs
        if (/^https?:\/\//i.test(rawImagePath)) continue;

        const absoluteImagePath = path.resolve(fileDir, rawImagePath);
        if (fs.existsSync(absoluteImagePath)) {
            const ext = path.extname(absoluteImagePath).toLowerCase() || '.png';
            const storedFilename = `${crypto.randomUUID()}${ext}`;
            const targetPath = path.join(uploadDir, storedFilename);

            if (isApply) {
                fs.copyFileSync(absoluteImagePath, targetPath);
            }
            const publicUrl = `/uploads/${storedFilename}`;
            updatedContent = updatedContent.replace(match[2], publicUrl);
            uploadedImages.push({ original: rawImagePath, stored: storedFilename, url: publicUrl });
        }
    }

    return { updatedContent, uploadedImages };
}

async function importSingleFile(filePath, parentFolder, isApply) {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const fileDir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));

    // Extract title from first H1 if present, or file name
    const h1Match = /^#\s+(.+)$/m.exec(rawContent);
    const title = h1Match ? h1Match[1].trim() : baseName.replace(/_/g, ' ').replace(/-/g, ' ');
    const slug = slugify(title);

    const { updatedContent, uploadedImages } = processNotionMarkdown(rawContent, fileDir, isApply);

    console.log(`\n----------------------------------------`);
    console.log(`📄 Page Title : ${title}`);
    console.log(`🔗 Slug       : ${slug}`);
    console.log(`📁 Parent     : ${parentFolder ? parentFolder.title : 'Root'}`);
    console.log(`🖼️  Images     : ${uploadedImages.length} image(s) processed`);

    if (!isApply) {
        console.log(`ℹ️ [DRY RUN] Chưa lưu vào Database. Dùng thêm option --apply để thực hiện ghi thật.`);
        return;
    }

    const existing = await Node.findOne({ parentId: parentFolder._id, slug, type: 'page' });
    if (existing) {
        console.log(`⚠️ Page đã tồn tại với slug '${slug}' trong folder '${parentFolder.title}'. Bỏ qua.`);
        return;
    }

    const newPage = await Node.create({
        title,
        slug,
        type: 'page',
        parentId: parentFolder._id,
        content: updatedContent,
        isPublished: true
    });

    console.log(`✅ Đã tạo thành công Page ID: ${newPage._id}`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help')) {
        printUsage();
        process.exit(0);
    }

    const targetPath = args[0];
    const isApply = args.includes('--apply');

    const parentIdIdx = args.indexOf('--parent-id');
    const parentIdArg = parentIdIdx !== -1 ? args[parentIdIdx + 1] : null;

    const parentPathIdx = args.indexOf('--parent-path');
    const parentPathArg = parentPathIdx !== -1 ? args[parentPathIdx + 1] : null;

    if (!fs.existsSync(targetPath)) {
        console.error(`❌ Đường dẫn '${targetPath}' không tồn tại.`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    try {
        const parentFolder = await resolveParentNode(parentIdArg, parentPathArg);
        const stat = fs.statSync(targetPath);

        if (stat.isFile()) {
            await importSingleFile(targetPath, parentFolder, isApply);
        } else if (stat.isDirectory()) {
            const files = fs.readdirSync(targetPath).filter((f) => f.endsWith('.md'));
            for (const file of files) {
                await importSingleFile(path.join(targetPath, file), parentFolder, isApply);
            }
        }
        console.log('\nDone!');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    main();
}
