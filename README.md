# Phạm Đức Quân — Security Blog

Blog cá nhân về an toàn thông tin, bài lab và write-up. Project dùng HTML/CSS/JavaScript thuần, Express và MongoDB; không dùng framework frontend hoặc mô hình Notion đầy đủ.

## Kiến trúc nội dung tối giản

Chỉ có hai loại node:

```text
folder
└── folder hoặc page

page
└── chỉ có nội dung Markdown, không có node con
```

Quy tắc:

- Root chỉ chứa folder.
- Folder có thể chứa folder con hoặc page.
- Page bắt buộc nằm trong một folder.
- Page không thể làm parent.
- Folder không tải hoặc render Markdown.
- Cây giới hạn tối đa 10 cấp.
- `parentId + slug` là duy nhất.

Model runtime:

```js
{
  title,
  slug,
  type,
  parentId,
  order,
  content,
  coverImage,
  tags,
  isPublished,
  views,
  likes,
  attachments,
  createdAt,
  updatedAt
}
```

`content`, `coverImage`, `tags`, `views`, `likes` và `attachments` chỉ được API sử dụng cho page. Các field cũ còn nằm trong document MongoDB không bị xóa tự động, nhưng runtime mới không phụ thuộc vào chúng.

## Quyền truy cập

Hệ thống chỉ có hai nhóm:

- `Admin`: một tài khoản trong collection `users`, đăng nhập bằng JWT cookie và có toàn quyền quản lý nội dung.
- `Public reader`: không có tài khoản, chỉ đọc nội dung public, tăng view, like/unlike và tải attachment public.

Không có đăng ký, đăng nhập reader, OAuth, profile, comment hoặc nhiều role.

## Lazy loading

Sidebar không tải toàn bộ tree. Mỗi lần mở folder, frontend chỉ gọi:

```http
GET /api/nodes?parentId=null
GET /api/nodes?parentId=<folder-id>
```

Response danh sách chỉ gồm:

```js
{
  _id,
  title,
  slug,
  type,
  parentId,
  order,
  isPublished,
  hasChildren,
  views,
  likes,
  updatedAt
}
```

Không có Markdown, cover image hoặc attachment trong response sidebar. Chi tiết chỉ được tải khi mở node:

```http
GET /api/nodes/:id
GET /api/nodes/by-path?path=/blog/web-security/sql-injection
```

URL sạch được resolve bằng cách duyệt tối đa 10 slug từ root. `path` không còn được ghi hoặc cập nhật khi đổi slug/move node.

## Chạy local

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm start
```

Mở:

```text
Trang chủ: http://localhost:8080
Blog:      http://localhost:8080/blog.html
Admin:     http://localhost:8080/admin.html
```

URL phân cấp cần được phục vụ qua Express, không mở trực tiếp file HTML.

## Admin

Tạo hoặc đổi tài khoản:

```powershell
npm run create-admin -- username mat-khau-toi-thieu-12-ky-tu
```

Admin hỗ trợ:

- Tạo folder gốc.
- Tạo folder hoặc page bên trong folder.
- Sửa title, slug, parent, order và trạng thái public.
- Sửa Markdown, tags và cover của page.
- Chọn và upload nhiều ảnh/file trong một lần; Markdown được chèn theo thứ tự đã chọn.
- Di chuyển bằng parent selector.
- Sắp xếp bằng nút `↑` và `↓`.
- Xóa node khi node không còn con.
- Xem thống kê view/like chỉ đọc.

Không có drag-and-drop, autosave, version history, collaborative editing hoặc page chứa page.

## API

Public:

```text
GET /api/nodes?parentId=null
GET /api/nodes?parentId=<folder-id>
GET /api/nodes/:id
GET /api/nodes/by-path?path=/...
GET /api/nodes/legacy-by-slug?slug=...
POST /api/nodes/:id/view
GET  /api/nodes/:id/reaction
POST /api/nodes/:id/like
GET  /api/nodes/:nodeId/attachments/:attachmentId/download
```

Admin:

```text
GET    /api/nodes?parentId=...&includeDrafts=1
GET    /api/nodes/:id?includeDrafts=1
GET    /api/nodes/folders
POST   /api/nodes
PUT    /api/nodes/:id
PATCH  /api/nodes/:id/move
PATCH  /api/nodes/reorder
DELETE /api/nodes/:id
```

Các API ghi dữ liệu và upload đều kiểm tra cookie/Bearer JWT ở backend.

## Public và draft

Node chỉ được đọc công khai khi chính node và toàn bộ folder cha đều public. Nếu một folder là draft, mọi page bên dưới đều:

- Không xuất hiện trong danh sách public.
- Không resolve được bằng URL.
- Không đọc được trực tiếp bằng ID.

Backend trả `404` để không làm lộ draft.

Quy tắc này được dùng chung cho đọc page, resolve URL, view, like, trạng thái reaction và download attachment.

## Lượt xem

Lượt xem chỉ áp dụng cho page public:

```http
POST /api/nodes/:id/view
```

- Mỗi request hợp lệ tăng đúng `1` bằng MongoDB `$inc`.
- Folder và draft trả `404`.
- Admin preview và API list không tăng view.
- Bot phổ biến theo user-agent không làm tăng view.
- Frontend dùng `sessionStorage` để chỉ ghi nhận một lần/page trong 30 phút.
- Backend giới hạn 60 request/15 phút/IP.

Client không thể sửa trực tiếp `views` qua API update node.

## Like ẩn danh

Frontend tạo UUID ngẫu nhiên `kbVisitorId` và lưu trong `localStorage`. UUID không chứa tên, email hoặc IP.

Khi gọi API, UUID được gửi qua header:

```http
X-Visitor-ID: <uuid>
```

Backend dùng HMAC với `VISITOR_HASH_SECRET` rồi chỉ lưu hash trong collection `pagereactions`:

```js
{
  nodeId,
  visitorHash,
  createdAt
}
```

Index `{ nodeId: 1, visitorHash: 1 }` là unique. Like/unlike chạy trong transaction:

- Like lặp lại của cùng visitor không tăng thêm.
- Visitor khác có thể like.
- Unlike lặp lại không làm số like âm.
- Không lưu IP, user-agent hoặc danh sách thông tin người đọc.

API:

```http
GET  /api/nodes/:id/reaction
POST /api/nodes/:id/like

{ "action": "like" }
{ "action": "unlike" }
```

Frontend khóa nút trong lúc request, dùng `aria-pressed` và rollback giao diện nếu API lỗi.

## Markdown và upload

Markdown được render bằng Marked rồi sanitize bằng DOMPurify với allowlist tag/attribute. Script, iframe, SVG, form, event handler, style và URL nguy hiểm không được giữ lại. Code copy dùng `textContent`.

Upload:

- Ảnh: JPEG, PNG, WebP, GIF; mặc định tối đa 5 MB.
- File: PDF, ZIP, JSON, TXT, LOG, Markdown, PCAP/PCAPNG; mặc định tối đa 50 MB.
- Tên file lưu được tạo ngẫu nhiên.
- HTML, JavaScript, SVG và executable không nằm trong allowlist.
- Attachment upload bắt buộc gửi `nodeId` của một page đã lưu.
- Metadata attachment được lưu trong page; URL download dùng `nodeId + attachmentId`.
- Public chỉ tải được attachment khi page và toàn bộ ancestor public.
- Admin có thể tải attachment của draft.
- Route download theo filename cũ chỉ còn dành cho Admin.
- Download trả `Content-Disposition: attachment`, `nosniff` và CSP `sandbox`.

Giới hạn được cấu hình trong `.env`:

```env
UPLOAD_IMAGE_MAX_MB=5
UPLOAD_FILE_MAX_MB=50
UPLOAD_DIR=
VISITOR_HASH_SECRET=replace-with-a-different-long-random-secret
```

Production bắt buộc có `VISITOR_HASH_SECRET` riêng, không dùng chung với JWT secret.

Có thể tạo secret bằng:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Sau đó lưu kết quả vào `backend/.env`; không commit giá trị thật.

## Import write-up từ DOCX

Project có công cụ cục bộ để chuyển báo cáo Word theo template thực tập hiện tại
thành cây bài viết PortSwigger. Công cụ này không chạy cùng server public và
không làm tăng tải cho người đọc.

Chạy thử và xuất Markdown/ảnh để kiểm tra:

```powershell
npm run import-writeup -- "D:\duong-dan\bao-cao.docx" --preview-dir ".\tmp\docx-preview"
```

Dry-run không sửa MongoDB hoặc `backend/uploads`.

Sau khi kiểm tra preview, nhập vào database:

```powershell
npm run import-writeup -- "D:\duong-dan\bao-cao.docx" --apply
```

Công cụ sẽ:

- Giữ hoặc tạo folder gốc `Blog`.
- Giữ hoặc tạo folder `PortSwigger`.
- Nhận diện và tạo lại folder theo từng nhóm lỗ hổng có trong báo cáo. Hiện tại
  importer hỗ trợ `SQL Injection`, `Cross-Site Scripting`, `Authentication`,
  `Access Control`, `Path Traversal`, `File Upload Vulnerabilities`,
  `Cross-Site Request Forgery` và `Server-Side Request Forgery`.
- Tách từng heading `Bài Lab` thành một page; page setup chỉ được tạo khi tài
  liệu thực sự có phần nội dung setup.
- Chuyển bảng, code và nội dung sang Markdown/HTML an toàn.
- Trích xuất ảnh gốc, đổi sang tên ngẫu nhiên và chèn URL vào đúng vị trí.
- Tạo toàn bộ folder/page mới ở trạng thái draft.
- Bỏ qua folder/page đã tồn tại thay vì ghi đè nội dung đã sửa thủ công.

Importer này được thiết kế cho template Word đang dùng các style `BTL-H1`,
`BTL-H2`, `BTL-H3`, `BTL-H4`, `BTL-Text` và `code BC`; nó không phải bộ
chuyển đổi DOCX tổng quát cho mọi tài liệu.

## Index MongoDB

Schema chỉ cần:

```js
{ parentId: 1, order: 1 }
{ parentId: 1, slug: 1 } // unique
PageReaction: { nodeId: 1, visitorHash: 1 } // unique
```

Project cũ từng có index `path` và `legacyPostId`. Script sau chỉ thay index, không sửa hoặc xóa document:

```powershell
npm run prepare-node-indexes
npm run prepare-node-indexes -- --apply
```

Chạy lệnh dry-run trước khi apply trên môi trường mới.

## Migration bài viết cũ

```powershell
npm run migrate-posts
```

Migration:

1. Tạo hoặc dùng folder gốc `Blog`.
2. Chuyển Post thành page bên trong Blog.
3. Giữ title, content, cover image, tags, views và timestamps.
4. Dùng slug xác định để chạy lại không tạo trùng trong trường hợp thông thường.
5. Không xóa collection `posts`.
6. Giữ resolver URL cũ `/post.html?slug=...`.

Nên backup MongoDB trước khi migration.

Nếu counter like bị lệch do sự cố ngoài transaction:

```powershell
npm run recount-likes
npm run recount-likes -- --apply
```

Lệnh mặc định là dry-run và tính lại `likes` từ collection reaction.

## Kiểm tra

```powershell
npm test
npm audit --omit=dev
```

Test dùng MongoDB replica set tạm thời, không chạm database thật. Các trường hợp gồm quyền Admin/public, draft ancestor, atomic view, like/unlike idempotent và đồng thời, visitor validation, attachment public/draft, header download, upload allowlist, XSS và quy tắc cây.

## Triển khai

1. Backup MongoDB và thư mục `backend/uploads`.
2. Cấu hình `.env` thật; không commit secret.
3. Chạy `npm install`.
4. Chạy `npm test`.
5. Chạy `npm run prepare-node-indexes`, xem dry-run rồi mới `--apply`.
6. Chạy `npm run recount-likes` để kiểm tra counter.
7. Chạy migration nếu còn bài viết cũ.
8. Dùng HTTPS và reverse proxy như Nginx.
9. Gắn volume bền vững cho `backend/uploads`.
10. Khởi động bằng process manager phù hợp.
11. Kiểm tra login Admin, view, like, attachment public/draft và một URL page sau deploy.

API không bật CORS `*`; cookie Admin dùng `httpOnly`, `sameSite=strict` và bật `secure` trong production.
