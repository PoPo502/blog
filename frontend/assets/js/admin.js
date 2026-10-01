document.addEventListener("DOMContentLoaded", () => {
  const ROOT_KEY = "root";
  const authSection = document.getElementById("auth-section");
  const dashboardSection = document.getElementById("dashboard-section");
  const authMessage = document.getElementById("auth-message");
  const editorEmpty = document.getElementById("editor-empty");
  const editorWorkspace = document.getElementById("editor-workspace");
  const treeContainer = document.getElementById("admin-tree");
  const nodeForm = document.getElementById("node-form");
  const nodeMessage = document.getElementById("node-message");
  const contentInput = document.getElementById("node-content");
  const preview = document.getElementById("markdown-preview");

  const childrenByParent = new Map();
  let allFolders = [];
  let selectedNode = null;
  let editorMode = "idle";
  let slugTouched = false;
  const expanded = new Set(
    JSON.parse(window.localStorage.getItem("adminTreeExpanded") || "[]")
  );

  function parentKey(parentId) {
    return parentId ? String(parentId) : ROOT_KEY;
  }

  function showMessage(element, message, type = "error") {
    element.textContent = message;
    element.className = `message visible ${type}`;
  }

  function clearMessage(element) {
    element.textContent = "";
    element.className = "message";
  }

  function showAuth() {
    authSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
  }

  function showDashboard() {
    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
  }

  async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options
    });
    if (response.status === 401 || response.status === 403) showAuth();
    return response;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function saveExpandedState() {
    window.localStorage.setItem("adminTreeExpanded", JSON.stringify([...expanded]));
  }

  async function loadChildren(parentId, force = false) {
    const key = parentKey(parentId);
    if (!force && childrenByParent.has(key)) return childrenByParent.get(key);

    const query = parentId ? encodeURIComponent(parentId) : "null";
    const response = await apiFetch(`/api/nodes?parentId=${query}&includeDrafts=1`);
    const data = await readJson(response);
    if (!response.ok || !Array.isArray(data)) {
      throw new Error(data.message || "Không thể tải danh sách node.");
    }
    childrenByParent.set(key, data);
    if (parentId) {
      const parent = findLoadedNode(parentId);
      if (parent) parent.hasChildren = data.length > 0;
    }
    return data;
  }

  async function loadFolders() {
    const response = await apiFetch("/api/nodes/folders");
    const data = await readJson(response);
    if (!response.ok || !Array.isArray(data)) {
      throw new Error(data.message || "Không thể tải danh sách folder.");
    }
    allFolders = data;
  }

  function findLoadedNode(id) {
    for (const nodes of childrenByParent.values()) {
      const found = nodes.find((node) => String(node._id) === String(id));
      if (found) return found;
    }
    return null;
  }

  function descendantFolderIds(folderId) {
    const result = new Set();
    const queue = [String(folderId)];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const folder of allFolders) {
        if (String(folder.parentId || "") !== current) continue;
        const id = String(folder._id);
        if (result.has(id)) continue;
        result.add(id);
        queue.push(id);
      }
    }
    return result;
  }

  function renderParentOptions(selectedParentId = null) {
    const select = document.getElementById("node-parent");
    const excluded = new Set();
    if (editorMode === "edit" && selectedNode?.type === "folder") {
      excluded.add(String(selectedNode._id));
      for (const id of descendantFolderIds(selectedNode._id)) excluded.add(id);
    }

    select.replaceChildren();
    if (selectedNode?.type === "folder" || (editorMode === "create" && selectedNode?.type === "folder")) {
      const rootOption = document.createElement("option");
      rootOption.value = "";
      rootOption.textContent = "— Cấp gốc —";
      select.appendChild(rootOption);
    }

    for (const folder of allFolders) {
      if (excluded.has(String(folder._id))) continue;
      const option = document.createElement("option");
      option.value = folder._id;
      option.textContent = `▣ ${folder.title}`;
      select.appendChild(option);
    }
    select.value = selectedParentId || "";
  }

  function renderTreeBranch(nodes) {
    const list = document.createElement("ul");
    list.className = "tree-list";

    for (const node of nodes) {
      const item = document.createElement("li");
      item.className = "tree-item";
      const row = document.createElement("div");
      row.className = "tree-row";
      if (selectedNode && String(selectedNode._id) === String(node._id)) {
        row.classList.add("active");
      }

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "tree-toggle";
      toggle.disabled = node.type !== "folder" || !node.hasChildren;
      toggle.textContent = toggle.disabled
        ? ""
        : expanded.has(String(node._id)) ? "▾" : "▸";
      toggle.addEventListener("click", async (event) => {
        event.stopPropagation();
        const id = String(node._id);
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
          await loadChildren(node._id);
        }
        saveExpandedState();
        renderTree();
      });

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "tree-node-button";
      const icon = document.createElement("span");
      icon.className = `tree-node-icon ${node.type}`;
      icon.textContent = node.type === "folder" ? "▣" : "•";
      const label = document.createElement("span");
      label.className = "tree-node-label";
      label.textContent = node.title;
      selectButton.append(icon, label);
      if (!node.isPublished) {
        const draft = document.createElement("span");
        draft.className = "tree-draft-badge";
        draft.textContent = "draft";
        selectButton.appendChild(draft);
      }
      selectButton.addEventListener("click", () => selectNode(node._id));
      row.append(toggle, selectButton);
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
      empty.textContent = "Chưa có nội dung. Hãy tạo folder đầu tiên.";
      treeContainer.appendChild(empty);
      return;
    }
    treeContainer.appendChild(renderTreeBranch(roots));
  }

  function renderChildren() {
    const section = document.getElementById("node-children-section");
    const container = document.getElementById("node-children");
    const isSavedFolder = editorMode === "edit" && selectedNode?.type === "folder";
    section.classList.toggle("hidden", !isSavedFolder);
    container.replaceChildren();
    if (!isSavedFolder) return;

    const children = childrenByParent.get(String(selectedNode._id)) || [];
    if (children.length === 0) {
      const message = document.createElement("p");
      message.className = "page-description";
      message.textContent = "Folder này chưa có nội dung.";
      container.appendChild(message);
      return;
    }

    for (const child of children) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node-child-card";
      const icon = document.createElement("span");
      icon.textContent = child.type === "folder" ? "▣" : "•";
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = child.title;
      const type = document.createElement("small");
      type.textContent = child.type === "folder" ? "Folder" : "Page";
      text.append(title, type);
      button.append(icon, text);
      button.addEventListener("click", () => selectNode(child._id));
      container.appendChild(button);
    }
  }

  function renderPreview() {
    preview.innerHTML = window.MarkdownRenderer.render(contentInput.value);
    preview.querySelectorAll("pre code").forEach((code) => window.hljs?.highlightElement(code));
  }

  function setEditorVisibility(visible) {
    editorEmpty.classList.toggle("hidden", visible);
    editorWorkspace.classList.toggle("hidden", !visible);
  }

  function breadcrumbPath(node) {
    if (!node.breadcrumb?.length) return "/";
    return `/${node.breadcrumb.map((item) => item.slug).join("/")}`;
  }

  function populateEditor(node) {
    setEditorVisibility(true);
    const isPage = node.type === "page";
    const editing = editorMode === "edit";
    document.getElementById("editor-mode-label").textContent =
      editing ? "Edit node" : "Create node";
    document.getElementById("editor-heading").textContent =
      editing ? node.title : `Tạo ${node.type}`;
    document.getElementById("editor-path").textContent =
      editing ? breadcrumbPath(node) : "Đường dẫn sẽ được tính khi lưu";

    document.getElementById("node-type").value = node.type;
    document.getElementById("node-title").value = node.title || "";
    document.getElementById("node-slug").value = node.slug || "";
    document.getElementById("node-order").value = node.order ?? 0;
    document.getElementById("node-tags").value = (node.tags || []).join(", ");
    document.getElementById("node-published").checked = Boolean(node.isPublished);
    document.getElementById("node-views").textContent = Math.max(0, Number(node.views || 0));
    document.getElementById("node-likes").textContent = Math.max(0, Number(node.likes || 0));
    document.getElementById("cover-image").value = node.coverImage || "";
    contentInput.value = node.content || "";

    document.querySelectorAll(".page-only-field").forEach((element) => {
      element.classList.toggle("hidden", !isPage);
    });
    const coverPreview = document.getElementById("cover-preview");
    if (isPage && node.coverImage) {
      coverPreview.src = node.coverImage;
      coverPreview.classList.add("visible");
    } else {
      coverPreview.removeAttribute("src");
      coverPreview.classList.remove("visible");
    }

    renderParentOptions(node.parentId);
    renderPreview();
    renderChildren();
    clearMessage(nodeMessage);

    document.getElementById("delete-node-button").classList.toggle("hidden", !editing);
    document.getElementById("move-up-button").classList.toggle("hidden", !editing);
    document.getElementById("move-down-button").classList.toggle("hidden", !editing);
    document.getElementById("new-child-folder").classList.toggle("hidden", !editing || isPage);
    document.getElementById("new-child-page").classList.toggle("hidden", !editing || isPage);
  }

  async function expandBreadcrumb(node) {
    for (const item of node.breadcrumb || []) {
      if (item.type !== "folder" || String(item._id) === String(node._id)) continue;
      expanded.add(String(item._id));
      await loadChildren(item._id);
    }
    saveExpandedState();
  }

  async function selectNode(id) {
    const response = await apiFetch(`/api/nodes/${encodeURIComponent(id)}?includeDrafts=1`);
    const data = await readJson(response);
    if (!response.ok) {
      window.alert(data.message || "Không thể tải node.");
      return;
    }

    selectedNode = data;
    editorMode = "edit";
    slugTouched = true;
    await expandBreadcrumb(data);
    if (data.type === "folder") {
      expanded.add(String(data._id));
      await loadChildren(data._id);
    }
    renderTree();
    populateEditor(data);
  }

  function startCreate(type, parentId = null) {
    if (type === "page" && !parentId) {
      window.alert("Page phải nằm trong một folder.");
      return;
    }
    const parentChildren = childrenByParent.get(parentKey(parentId)) || [];
    editorMode = "create";
    selectedNode = {
      type,
      title: "",
      slug: "",
      parentId,
      order: parentChildren.length,
      tags: [],
      coverImage: "",
      content: "",
      isPublished: true,
      views: 0,
      likes: 0,
      breadcrumb: []
    };
    slugTouched = false;
    populateEditor(selectedNode);
    document.getElementById("node-title").focus();
    renderTree();
  }

  async function refreshAfterChange(parentIds, selectedId = null) {
    const uniqueParents = [...new Set(parentIds.map((id) => parentKey(id)))];
    for (const key of uniqueParents) {
      await loadChildren(key === ROOT_KEY ? null : key, true);
    }
    await loadFolders();
    renderTree();
    if (selectedId) await selectNode(selectedId);
  }

  async function reorderSelected(direction) {
    if (!selectedNode || editorMode !== "edit") return;
    const key = parentKey(selectedNode.parentId);
    const siblings = [...(childrenByParent.get(key) || [])];
    const index = siblings.findIndex((node) => String(node._id) === String(selectedNode._id));
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return;

    [siblings[index], siblings[nextIndex]] = [siblings[nextIndex], siblings[index]];
    const response = await apiFetch("/api/nodes/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: selectedNode.parentId || null,
        items: siblings.map((node) => ({ id: node._id }))
      })
    });
    const data = await readJson(response);
    if (!response.ok) {
      window.alert(data.message || "Không thể sắp xếp node.");
      return;
    }
    childrenByParent.set(key, data);
    await selectNode(selectedNode._id);
  }

  function insertAtCursor(text) {
    const start = contentInput.selectionStart;
    const end = contentInput.selectionEnd;
    const prefix = start > 0 && contentInput.value[start - 1] !== "\n" ? "\n\n" : "";
    contentInput.setRangeText(`${prefix}${text}\n`, start, end, "end");
    contentInput.focus();
    renderPreview();
  }

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage(authMessage);
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: document.getElementById("login-username").value,
          password: document.getElementById("login-password").value
        })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || "Đăng nhập thất bại.");
      document.getElementById("login-form").reset();
      showDashboard();
      await Promise.all([loadChildren(null, true), loadFolders()]);
      renderTree();
    } catch (error) {
      showMessage(authMessage, error.message);
    }
  });

  document.getElementById("logout-button").addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    showAuth();
  });

  document.getElementById("new-root-folder").addEventListener("click", () => {
    startCreate("folder", null);
  });
  document.getElementById("new-child-folder").addEventListener("click", () => {
    if (selectedNode?.type === "folder") startCreate("folder", selectedNode._id);
  });
  document.getElementById("new-child-page").addEventListener("click", () => {
    if (selectedNode?.type === "folder") startCreate("page", selectedNode._id);
  });

  document.getElementById("node-title").addEventListener("input", (event) => {
    if (!slugTouched) document.getElementById("node-slug").value = slugify(event.target.value);
  });
  document.getElementById("node-slug").addEventListener("input", () => {
    slugTouched = true;
  });
  contentInput.addEventListener("input", renderPreview);

  document.getElementById("cover-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    const response = await apiFetch("/api/upload/cover", {
      method: "POST",
      body: formData
    });
    const data = await readJson(response);
    if (!response.ok) {
      window.alert(data.message || "Upload ảnh thất bại.");
      return;
    }
    document.getElementById("cover-image").value = data.url;
    const coverPreview = document.getElementById("cover-preview");
    coverPreview.src = data.url;
    coverPreview.classList.add("visible");
  });

  document.getElementById("upload-button").addEventListener("click", async (event) => {
    const input = document.getElementById("attachment-file");
    const files = [...input.files];
    if (files.length === 0) {
      window.alert("Hãy chọn ít nhất một file.");
      return;
    }
    if (editorMode !== "edit" || selectedNode?.type !== "page" || !selectedNode?._id) {
      window.alert("Hãy lưu page trước khi upload file đính kèm.");
      return;
    }

    const button = event.currentTarget;
    const status = document.getElementById("upload-status");
    button.disabled = true;
    status.textContent = "";

    try {
      let uploaded = 0;
      for (const file of files) {
        const isImage = ["image/jpeg", "image/png", "image/webp", "image/gif"]
          .includes(file.type);
        const formData = new FormData();
        if (!isImage) formData.append("nodeId", selectedNode._id);
        formData.append(isImage ? "image" : "file", file);

        const response = await apiFetch(
          isImage ? "/api/upload/image" : "/api/upload/attachment",
          { method: "POST", body: formData }
        );
        const data = await readJson(response);
        if (!response.ok) {
          throw new Error(`${file.name}: ${data.message || "Upload thất bại."}`);
        }
        insertAtCursor(isImage
          ? `![${data.name}](${data.url})`
          : `[Download: ${data.name} (${formatBytes(data.size)})](${data.url})`);
        uploaded += 1;
      }
      input.value = "";
      status.textContent = `Đã upload và chèn ${uploaded} file vào nội dung.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  nodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage(nodeMessage);
    const oldParentId = editorMode === "edit" ? selectedNode.parentId : null;
    const type = selectedNode.type;
    const payload = {
      type,
      title: document.getElementById("node-title").value,
      slug: document.getElementById("node-slug").value,
      parentId: document.getElementById("node-parent").value || null,
      order: Number(document.getElementById("node-order").value || 0),
      isPublished: document.getElementById("node-published").checked
    };
    if (type === "page") {
      payload.tags = document.getElementById("node-tags").value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      payload.coverImage = document.getElementById("cover-image").value;
      payload.content = contentInput.value;
    }

    const saveButton = document.getElementById("save-node-button");
    saveButton.disabled = true;
    try {
      const isCreate = editorMode === "create";
      const response = await apiFetch(
        isCreate ? "/api/nodes" : `/api/nodes/${encodeURIComponent(selectedNode._id)}`,
        {
          method: isCreate ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || "Không thể lưu node.");

      if (data.parentId) expanded.add(String(data.parentId));
      saveExpandedState();
      await refreshAfterChange([oldParentId, data.parentId], data._id);
      showMessage(nodeMessage, "Đã lưu node.", "success");
    } catch (error) {
      showMessage(nodeMessage, error.message);
    } finally {
      saveButton.disabled = false;
    }
  });

  document.getElementById("delete-node-button").addEventListener("click", async () => {
    if (!selectedNode || !window.confirm(`Xóa "${selectedNode.title}"?`)) return;
    const parentId = selectedNode.parentId;
    const response = await apiFetch(`/api/nodes/${encodeURIComponent(selectedNode._id)}`, {
      method: "DELETE"
    });
    const data = await readJson(response);
    if (!response.ok) {
      window.alert(data.message || "Không thể xóa node.");
      return;
    }
    await refreshAfterChange([parentId]);
    selectedNode = null;
    editorMode = "idle";
    setEditorVisibility(false);
    renderTree();
  });

  document.getElementById("move-up-button").addEventListener("click", () => reorderSelected(-1));
  document.getElementById("move-down-button").addEventListener("click", () => reorderSelected(1));

  (async function checkSession() {
    try {
      const response = await apiFetch("/api/auth/me");
      if (!response.ok) {
        showAuth();
        return;
      }
      showDashboard();
      await Promise.all([loadChildren(null, true), loadFolders()]);
      renderTree();
    } catch {
      showAuth();
    }
  })();
});
