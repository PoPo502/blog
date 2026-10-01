const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });

const Node = require('../models/Node');
const { uploadDir } = require('../config/storage');
const { convertDocxWriteup } = require('../services/docx-writeup-importer');

function parseArguments(argv) {
    const options = {
        apply: false,
        docxPath: '',
        previewDir: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--apply') {
            options.apply = true;
        } else if (argument === '--preview-dir') {
            options.previewDir = argv[index + 1] || '';
            index += 1;
        } else if (!argument.startsWith('--') && !options.docxPath) {
            options.docxPath = argument;
        } else {
            throw new Error(`Tham số không hợp lệ: ${argument}`);
        }
    }

    if (!options.docxPath) {
        throw new Error(
            'Cách dùng: npm run import-writeup -- "duong-dan.docx" [--preview-dir thu-muc] [--apply]'
        );
    }
    return options;
}

function pageImageCount(page) {
    return Array.isArray(page.imageIds) ? page.imageIds.length : 0;
}

function printSummary(result) {
    console.log(`Nguồn: ${result.sourcePath}`);
    console.log(`Folder chuyên mục: ${result.categories.length}`);
    console.log(`Page: ${result.pages.length}`);
    console.log(`Ảnh trong DOCX: ${result.images.length}`);
    console.log(`Ảnh chưa được dùng: ${result.unusedImageIds.length}`);
    console.log('');

    for (const page of result.pages) {
        const location = page.categorySlug
            ? `portswigger/${page.categorySlug}/${page.slug}`
            : `portswigger/${page.slug}`;
        console.log(
            `- ${page.title} | ảnh: ${pageImageCount(page)} | /blog/${location}`
        );
    }

    if (result.messages.length > 0) {
        console.log('');
        console.log('Cảnh báo chuyển đổi:');
        for (const message of result.messages) {
            console.log(`- ${message.type}: ${message.message}`);
        }
    }
}

async function writePreview(result, previewDir) {
    if (!previewDir) return;
    const outputDir = path.resolve(previewDir);
    const mediaDir = path.join(outputDir, 'media');
    await fs.promises.mkdir(mediaDir, { recursive: true });

    const imageById = new Map(result.images.map((image) => [image.id, image]));
    for (const image of result.images) {
        const filename = `image-${String(image.id).padStart(3, '0')}${image.extension}`;
        await fs.promises.writeFile(path.join(mediaDir, filename), image.buffer);
    }

    for (const page of result.pages) {
        let content = page.content;
        for (const imageId of page.imageIds) {
            const image = imageById.get(imageId);
            const filename = `image-${String(image.id).padStart(3, '0')}${image.extension}`;
            content = content.replaceAll(image.placeholder, `media/${filename}`);
        }
        const categoryDir = page.categorySlug
            ? path.join(outputDir, page.categorySlug)
            : outputDir;
        await fs.promises.mkdir(categoryDir, { recursive: true });
        await fs.promises.writeFile(
            path.join(categoryDir, `${page.slug}.md`),
            `${content}\n`,
            'utf8'
        );
    }

    console.log('');
    console.log(`Preview đã được ghi tại: ${outputDir}`);
}

async function getOrCreateFolder({ parentId, title, slug, order, isPublished }) {
    const existing = await Node.findOne({ parentId, slug });
    if (existing) {
        if (existing.type !== 'folder') {
            throw new Error(`Slug folder bị trùng với page: ${slug}`);
        }
        console.log(`SKIP folder /${slug} đã tồn tại.`);
        return existing;
    }

    const folder = await Node.create({
        title,
        slug,
        type: 'folder',
        parentId,
        order,
        isPublished
    });
    console.log(`OK   folder ${title}`);
    return folder;
}

async function writePageImages(page, result) {
    const createdFiles = [];
    const imageById = new Map(result.images.map((image) => [image.id, image]));
    let content = page.content;

    try {
        for (const imageId of page.imageIds) {
            const image = imageById.get(imageId);
            if (!image) throw new Error(`Không tìm thấy ảnh ${imageId}.`);
            const storedName = `${crypto.randomUUID()}${image.extension}`;
            await fs.promises.writeFile(
                path.join(uploadDir, storedName),
                image.buffer,
                { flag: 'wx' }
            );
            createdFiles.push(storedName);
            content = content.replaceAll(image.placeholder, `/uploads/${storedName}`);
        }
        return { content, createdFiles };
    } catch (error) {
        await Promise.all(createdFiles.map((storedName) => (
            fs.promises.unlink(path.join(uploadDir, storedName)).catch(() => {})
        )));
        throw error;
    }
}

async function createPage({ page, parentId, order, result }) {
    const existing = await Node.findOne({ parentId, slug: page.slug });
    if (existing) {
        if (existing.type !== 'page') {
            throw new Error(`Slug page bị trùng với folder: ${page.slug}`);
        }
        console.log(`SKIP page ${page.title} đã tồn tại.`);
        return { created: false, node: existing };
    }

    const { content, createdFiles } = await writePageImages(page, result);
    try {
        const node = await Node.create({
            title: page.title,
            slug: page.slug,
            type: 'page',
            parentId,
            order,
            content,
            tags: page.tags,
            isPublished: false
        });
        console.log(`OK   page ${page.title} (${page.imageIds.length} ảnh, draft)`);
        return { created: true, node };
    } catch (error) {
        await Promise.all(createdFiles.map((storedName) => (
            fs.promises.unlink(path.join(uploadDir, storedName)).catch(() => {})
        )));
        throw error;
    }
}

async function applyImport(result) {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI chưa được cấu hình trong backend/.env.');
    }

    await fs.promises.mkdir(uploadDir, { recursive: true });
    await mongoose.connect(process.env.MONGODB_URI);
    await Node.init();

    const blog = await getOrCreateFolder({
        parentId: null,
        title: 'Blog',
        slug: 'blog',
        order: 0,
        isPublished: true
    });
    const portswigger = await getOrCreateFolder({
        parentId: blog._id,
        title: 'PortSwigger',
        slug: 'portswigger',
        order: 0,
        isPublished: false
    });

    const categoryFolders = new Map();
    const lastPortSwiggerChild = await Node.findOne({ parentId: portswigger._id })
        .sort({ order: -1 })
        .select('order')
        .lean();
    const firstNewCategoryOrder = lastPortSwiggerChild
        ? Number(lastPortSwiggerChild.order || 0) + 1
        : 0;
    for (let index = 0; index < result.categories.length; index += 1) {
        const category = result.categories[index];
        const folder = await getOrCreateFolder({
            parentId: portswigger._id,
            title: category.title,
            slug: category.slug,
            order: firstNewCategoryOrder + index,
            isPublished: false
        });
        categoryFolders.set(category.slug, folder);
    }

    let createdPages = 0;
    for (const page of result.pages) {
        const parent = page.categorySlug
            ? categoryFolders.get(page.categorySlug)
            : portswigger;
        if (!parent) {
            throw new Error(`Không tìm thấy folder cha cho page ${page.title}.`);
        }
        const siblingPages = result.pages.filter(
            (candidate) => candidate.categorySlug === page.categorySlug
        );
        const order = siblingPages.findIndex((candidate) => candidate.slug === page.slug);
        const created = await createPage({
            page,
            parentId: parent._id,
            order,
            result
        });
        if (created.created) createdPages += 1;
    }

    console.log('');
    console.log(`Import hoàn tất: ${createdPages}/${result.pages.length} page mới.`);
    console.log('Tất cả folder PortSwigger và page mới đang ở trạng thái draft.');
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const result = await convertDocxWriteup(options.docxPath);

    if (result.pages.length === 0) {
        throw new Error('Không tìm thấy page nào để import.');
    }
    if (result.unusedImageIds.length > 0) {
        throw new Error(
            `Có ${result.unusedImageIds.length} ảnh không thuộc page nào: ` +
            result.unusedImageIds.join(', ')
        );
    }

    printSummary(result);
    await writePreview(result, options.previewDir);

    if (!options.apply) {
        console.log('');
        console.log('Đây là dry-run, database và uploads chưa bị thay đổi.');
        console.log('Thêm --apply sau khi đã kiểm tra preview để nhập các page draft.');
        return;
    }

    await applyImport(result);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
