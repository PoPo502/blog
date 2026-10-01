document.addEventListener("DOMContentLoaded", async () => {
  const ROOT_KEY = "root";
  const treeContainer = document.getElementById("public-tree");
  const contentContainer = document.getElementById("knowledge-content");
  const isRootPage = window.location.pathname === "/blog.html";
  let currentPath = null;
  try {
    currentPath = isRootPage ? null : decodeURIComponent(window.location.pathname).replace(/\/$/, "");
  } catch {
    currentPath = null;
  }

  const expanded = new Set(
    JSON.parse(window.localStorage.getItem("publicTreeExpanded") || "[]")
  );
  const childrenByParent = new Map();
  const VIEW_WINDOW_MS = 30 * 60 * 1000;

  function readApiError(data, fallback) {
    return data?.error?.message || data?.message || fallback;
  }

  function t(key, fallback) {
    return window.PQ_I18N ? window.PQ_I18N.t(key, fallback) : fallback;
  }

  function createVisitorId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join("")
    ].join("-");
  }

  function getVisitorId() {
    const key = "kbVisitorId";
    try {
      const current = window.localStorage.getItem(key);
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(current || "")
      ) {
        return current;
      }
      const created = createVisitorId();
      window.localStorage.setItem(key, created);
      return created;
    } catch {
      return createVisitorId();
    }
  }

  function parentKey(parentId) {
    return parentId ? String(parentId) : ROOT_KEY;
  }

  function saveExpanded() {
    window.localStorage.setItem("publicTreeExpanded", JSON.stringify([...expanded]));
  }

  function decorateNodes(nodes, parentPath = "") {
    return nodes.map((node) => ({
      ...node,
      publicPath: `${parentPath}/${node.slug}`.replace(/\/+/g, "/")
    }));
  }

  async function loadChildren(parentNode = null, force = false) {
    const key = parentKey(parentNode?._id);
    if (!force && childrenByParent.has(key)) return childrenByParent.get(key);

    const parentId = parentNode ? encodeURIComponent(parentNode._id) : "null";
    const response = await fetch(`/api/nodes?parentId=${parentId}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Không thể tải danh sách nội dung.");
    const nodes = decorateNodes(
      await response.json(),
      parentNode?.publicPath || ""
    );
    childrenByParent.set(key, nodes);

    if (parentNode) {
      const loadedParent = findLoadedNode(parentNode._id);
      if (loadedParent) loadedParent.hasChildren = nodes.length > 0;
    }
    return nodes;
  }

  function findLoadedNode(id) {
    for (const nodes of childrenByParent.values()) {
      const found = nodes.find((node) => String(node._id) === String(id));
      if (found) return found;
    }
    return null;
  }

  function formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(value));
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function showError(message) {
    const error = document.createElement("p");
    error.className = "state-message";
    error.textContent = message;
    contentContainer.replaceChildren(error);
  }

  function renderTreeBranch(nodes) {
    const list = document.createElement("ul");
    list.className = "tree-list";

    for (const node of nodes) {
      const item = document.createElement("li");
      item.className = "tree-item";
      const row = document.createElement("div");
      row.className = "tree-row";
      if (currentPath === node.publicPath) row.classList.add("active");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-toggle";
      toggle.disabled = node.type !== "folder" || !node.hasChildren;
      toggle.textContent = toggle.disabled
        ? ""
        : expanded.has(String(node._id)) ? "▾" : "▸";
      toggle.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = String(node._id);
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
          await loadChildren(node);
        }
        saveExpanded();
        renderTree();
      });

      const link = document.createElement("a");
      link.className = "tree-node-button";
      link.href = node.publicPath;
      const icon = document.createElement("span");
      icon.className = `tree-node-icon ${node.type}`;
      icon.textContent = node.type === "folder" ? "▣" : "•";
      const label = document.createElement("span");
      label.className = "tree-node-label";
      label.textContent = node.title;
      link.append(icon, label);

      row.append(toggle, link);
      item.appendChild(row);
      const children = childrenByParent.get(String(node._id));
      if (node.type === "folder" && expanded.has(String(node._id)) && children) {
        item.appendChild(renderTreeBranch(children));
      }
      list.appendChild(item);
    }
    return list;
  }

  function renderTree() {
    treeContainer.replaceChildren();
    const roots = childrenByParent.get(ROOT_KEY) || [];
    if (roots.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = t("empty_tree", "Chưa có nội dung công khai.");
      treeContainer.appendChild(empty);
      return;
    }
    treeContainer.appendChild(renderTreeBranch(roots));
  }

  function makeHeadingId(text, index) {
    const id = String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return id || `section-${index + 1}`;
  }

  function enhanceMarkdown(contentElement) {
    contentElement.querySelectorAll("pre code").forEach((code) => {
      window.hljs?.highlightElement(code);
      const pre = code.closest("pre");
      if (!pre || pre.parentElement?.classList.contains("code-block")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const button = document.createElement("button");
      button.className = "copy-code";
      button.type = "button";
      button.textContent = "Copy";
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      });
      wrapper.appendChild(button);
    });

    contentElement.querySelectorAll('a[href^="/api/upload/files/"]').forEach((link) => {
      link.classList.add("download-card");
      link.setAttribute("download", "");
    });
  }

  function renderMarkdown(value) {
    const article = document.createElement("article");
    article.className = "post-content";
    article.innerHTML = window.MarkdownRenderer.render(value);
    enhanceMarkdown(article);
    return article;
  }

  function buildTableOfContents(contentElement) {
    const headings = [...contentElement.querySelectorAll("h2, h3")];
    if (headings.length < 2) return null;
    const used = new Set();
    const toc = document.createElement("nav");
    toc.className = "table-of-contents";
    toc.setAttribute("aria-label", t("toc", "Mục lục"));
    const title = document.createElement("strong");
    title.textContent = t("toc", "Mục lục");
    const list = document.createElement("ul");

    headings.forEach((heading, index) => {
      let id = makeHeadingId(heading.textContent, index);
      while (used.has(id)) id = `${id}-${index + 1}`;
      used.add(id);
      heading.id = id;
      const item = document.createElement("li");
      if (heading.tagName === "H3") item.className = "toc-level-3";
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = heading.textContent;
      item.appendChild(link);
      list.appendChild(item);
    });
    toc.append(title, list);
    return toc;
  }

  function breadcrumbWithPaths(items) {
    let path = "";
    return (items || []).map((item) => {
      path += `/${item.slug}`;
      return { ...item, publicPath: path };
    });
  }

  function renderBreadcrumb(node = null) {
    const nav = document.createElement("nav");
    nav.className = "breadcrumb";
    nav.setAttribute("aria-label", "Breadcrumb");
    const home = document.createElement("a");
    home.href = "/blog.html";
    home.textContent = "Blog";
    nav.appendChild(home);

    for (const item of breadcrumbWithPaths(node?.breadcrumb)) {
      const separator = document.createElement("span");
      separator.textContent = "/";
      nav.appendChild(separator);
      if (String(item._id) === String(node._id)) {
        const current = document.createElement("span");
        current.textContent = item.title;
        nav.appendChild(current);
      } else {
        const link = document.createElement("a");
        link.href = item.publicPath;
        link.textContent = item.title;
        nav.appendChild(link);
      }
    }
    return nav;
  }

  function renderChildCards(children) {
    const grid = document.createElement("div");
    grid.className = "public-node-grid";
    if (!children || children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "state-message";
      empty.textContent = t("empty_folder", "Chưa có nội dung bên trong.");
      grid.appendChild(empty);
      return grid;
    }

    for (const node of children) {
      const link = document.createElement("a");
      link.className = "public-node-card";
      link.href = node.publicPath;
      const icon = document.createElement("span");
      icon.className = `public-node-icon ${node.type}`;
      icon.textContent = node.type === "folder" ? "▣" : "•";
      const body = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = node.title;
      const type = document.createElement("small");
      type.textContent = node.type === "folder"
        ? "Folder"
        : `${Math.max(0, Number(node.views || 0))} ${t("views", "lượt xem")} · ${Math.max(0, Number(node.likes || 0))} ${t("likes", "lượt thích")}`;
      body.append(title, type);
      link.append(icon, body);
      grid.appendChild(link);
    }
    return grid;
  }

  function renderRoot(roots) {
    document.title = "Blog | Phạm Đức Quân";
    const header = document.createElement("header");
    header.className = "knowledge-header";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = t("blog_eyebrow", "Bài viết an toàn thông tin");
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = "Blog";
    header.append(eyebrow, title);
    contentContainer.replaceChildren(renderBreadcrumb(), header, renderChildCards(roots));
  }

  async function renderFolder(node) {
    document.title = `${node.title} | Phạm Đức Quân`;
    const loaded = findLoadedNode(node._id) || {
      ...node,
      publicPath: currentPath
    };
    loaded.publicPath = currentPath;
    expanded.add(String(node._id));
    saveExpanded();
    const children = await loadChildren(loaded, true);
    renderTree();

    const header = document.createElement("header");
    header.className = "knowledge-header";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Folder";
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = node.title;
    header.append(eyebrow, title);
    contentContainer.replaceChildren(
      renderBreadcrumb(node),
      header,
      renderChildCards(children)
    );
  }

  function renderAttachments(node) {
    if (!node.attachments?.length) return null;
    const section = document.createElement("section");
    section.className = "page-attachments";
    const title = document.createElement("h2");
    title.textContent = t("attachments", "Tệp đính kèm");
    section.appendChild(title);
    for (const attachment of node.attachments) {
      const link = document.createElement("a");
      link.className = "download-card";
      link.href = attachment.url;
      link.setAttribute("download", "");
      link.textContent = `${attachment.name} (${formatBytes(attachment.size)})`;
      section.appendChild(link);
    }
    return section;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "0 B";
    const value = Number(bytes);
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  async function recordPageView(node, viewsValue, status) {
    const storageKey = `kbPageView:${node._id}`;
    try {
      const lastRecorded = Number(window.sessionStorage.getItem(storageKey) || 0);
      if (Date.now() - lastRecorded < VIEW_WINDOW_MS) return;
    } catch {
      // Continue without session storage when it is unavailable.
    }

    try {
      const response = await fetch(`/api/nodes/${encodeURIComponent(node._id)}/view`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(readApiError(data, "Không thể ghi nhận lượt xem."));
      viewsValue.textContent = Math.max(0, Number(data.views || 0));
      try {
        window.sessionStorage.setItem(storageKey, String(Date.now()));
      } catch {
        // The view is still valid even when storage is unavailable.
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function setupLikeButton(node, button, likesValue, status) {
    const visitorId = getVisitorId();
    let liked = false;
    let likes = Math.max(0, Number(node.likes || 0));

    function render() {
      button.setAttribute("aria-pressed", String(liked));
      button.setAttribute(
        "aria-label",
        liked ? t("unlike_aria", "Bỏ thích page này") : t("like_aria", "Thích page này")
      );
      button.classList.toggle("liked", liked);
      likesValue.textContent = likes;
      button.querySelector(".like-button-label").textContent =
        liked ? t("liked", "Đã thích") : t("like", "Thích");
    }
    render();

    try {
      const response = await fetch(
        `/api/nodes/${encodeURIComponent(node._id)}/reaction`,
        {
          headers: {
            Accept: "application/json",
            "X-Visitor-ID": visitorId
          }
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(readApiError(data, "Không thể tải trạng thái like."));
      liked = Boolean(data.liked);
      likes = Math.max(0, Number(data.likes || 0));
      render();
    } catch (error) {
      status.textContent = error.message;
    }

    button.addEventListener("click", async () => {
      const previousLiked = liked;
      const previousLikes = likes;
      liked = !liked;
      likes = Math.max(0, likes + (liked ? 1 : -1));
      button.disabled = true;
      status.textContent = "";
      render();

      try {
        const response = await fetch(
          `/api/nodes/${encodeURIComponent(node._id)}/like`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-Visitor-ID": visitorId
            },
            body: JSON.stringify({ action: liked ? "like" : "unlike" })
          }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(readApiError(data, "Không thể cập nhật lượt thích."));
        liked = Boolean(data.liked);
        likes = Math.max(0, Number(data.likes || 0));
      } catch (error) {
        liked = previousLiked;
        likes = previousLikes;
        status.textContent = error.message;
      } finally {
        button.disabled = false;
        render();
      }
    });
  }

  async function renderPage(node) {
    document.title = `${node.title} | Phạm Đức Quân`;
    const header = document.createElement("header");
    header.className = "post-header";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = t("security_page", "Security page");
    const title = document.createElement("h1");
    title.className = "post-title";
    title.textContent = node.title;
    const meta = document.createElement("div");
    meta.className = "post-meta";
    for (const value of [
      `${t("created", "Tạo")} ${formatDate(node.createdAt)}`,
      `${t("updated", "Cập nhật")} ${formatDate(node.updatedAt)}`
    ]) {
      const item = document.createElement("span");
      item.textContent = value;
      meta.appendChild(item);
    }
    const tags = document.createElement("div");
    tags.className = "tag-list";
    for (const tagName of node.tags || []) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `#${tagName}`;
      tags.appendChild(tag);
    }
    header.append(eyebrow, title, meta, tags);

    const engagement = document.createElement("div");
    engagement.className = "page-engagement";
    const viewsStat = document.createElement("span");
    viewsStat.className = "engagement-stat";
    viewsStat.append("👁 ");
    const viewsValue = document.createElement("strong");
    viewsValue.textContent = Math.max(0, Number(node.views || 0));
    viewsStat.append(viewsValue, ` ${t("views", "lượt xem")}`);

    const likeButton = document.createElement("button");
    likeButton.type = "button";
    likeButton.className = "like-button";
    likeButton.setAttribute("aria-pressed", "false");
    const likeLabel = document.createElement("span");
    likeLabel.className = "like-button-label";
    likeLabel.textContent = t("like", "Thích");
    const likesValue = document.createElement("strong");
    likesValue.textContent = Math.max(0, Number(node.likes || 0));
    likeButton.append("♥ ", likeLabel, " · ", likesValue);
    const engagementStatus = document.createElement("span");
    engagementStatus.className = "engagement-status";
    engagementStatus.setAttribute("role", "status");
    engagement.append(viewsStat, likeButton, engagementStatus);
    header.appendChild(engagement);

    const coverUrl = safeImageUrl(node.coverImage);
    if (coverUrl) {
      const cover = document.createElement("img");
      cover.className = "post-cover";
      cover.src = coverUrl;
      cover.alt = node.title;
      cover.decoding = "async";
      header.appendChild(cover);
    }

    const content = renderMarkdown(node.content);
    const toc = buildTableOfContents(content);
    contentContainer.replaceChildren(renderBreadcrumb(node), header);
    if (toc) contentContainer.appendChild(toc);
    contentContainer.appendChild(content);
    const attachments = renderAttachments(node);
    if (attachments) contentContainer.appendChild(attachments);

    await Promise.all([
      recordPageView(node, viewsValue, engagementStatus),
      setupLikeButton(node, likeButton, likesValue, engagementStatus)
    ]);
  }

  async function expandResolvedBreadcrumb(node) {
    const parts = breadcrumbWithPaths(node.breadcrumb);
    let currentNodes = childrenByParent.get(ROOT_KEY) || [];
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      const folder = currentNodes.find((item) => String(item._id) === String(part._id));
      if (!folder || folder.type !== "folder") break;
      folder.publicPath = part.publicPath;
      expanded.add(String(folder._id));
      currentNodes = await loadChildren(folder);
    }
    saveExpanded();
  }

  let loadedRoots = [];
  let currentNode = null;

  try {
    const roots = await loadChildren();
    loadedRoots = roots;
    if (isRootPage) {
      renderTree();
      renderRoot(roots);
      return;
    }
    if (!currentPath) throw new Error("Đường dẫn không hợp lệ.");

    const response = await fetch(
      `/api/nodes/by-path?path=${encodeURIComponent(currentPath)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) throw new Error("Trang không tồn tại hoặc chưa được xuất bản.");
    const node = await response.json();
    currentNode = node;
    await expandResolvedBreadcrumb(node);
    renderTree();
    if (node.type === "folder") await renderFolder(node);
    else await renderPage(node);
  } catch (error) {
    console.error(error);
    renderTree();
    showError(error.message);
  }

  window.addEventListener("pq:languagechange", async () => {
    renderTree();
    if (isRootPage && loadedRoots.length > 0) {
      renderRoot(loadedRoots);
    } else if (currentNode) {
      if (currentNode.type === "folder") await renderFolder(currentNode);
      else await renderPage(currentNode);
    }
  });
});
