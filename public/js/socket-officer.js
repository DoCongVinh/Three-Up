/**
 * TRANG CÁN BỘ — nhận phản hồi mới theo thời gian thực và xác nhận.
 *
 * Luồng:
 *  1. POST /api/auth/login  -> nhận { token, user } (Bearer token cho mọi API cán bộ).
 *  2. Kết nối Socket.io với auth { role: "officer", token } -> server cho vào
 *     phòng "ward:<phường/xã>" (hoặc "role:admin" với Cấp Tỉnh).
 *  3. Sự kiện "new-feedback" -> chèn vào đầu danh sách, phát toast + âm thanh + rung.
 *  4. Bấm "Xác nhận" -> POST /api/feedbacks/:id/confirm (server bắn "feedback-confirmed"
 *     cho người dân).
 *
 * Trong dự án thật chỉ cần 3 đoạn được đánh dấu ★.
 */
(() => {
  "use strict";

  const API = "/api";
  const $ = (id) => document.getElementById(id);
  const TEAL = "#0f766e";

  const session = {
    get: () => {
      try {
        return JSON.parse(localStorage.getItem("khanhhoa.officer.session") || "null");
      } catch {
        return null;
      }
    },
    save: (value) => localStorage.setItem("khanhhoa.officer.session", JSON.stringify(value)),
    clear: () => localStorage.removeItem("khanhhoa.officer.session"),
  };

  /* --------------------------------- API ---------------------------------- */

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = session.get()?.token;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({ ok: false, error: "Máy chủ trả dữ liệu không hợp lệ." }));
    if (response.status === 401) logout(true);
    return data;
  }

  /* ------------------------ ★ 1 + 2. Đăng nhập + Socket -------------------- */

  let socket = null;

  function connectSocket() {
    const token = session.get()?.token;
    if (!token) return;

    socket?.disconnect();
    socket = io({ auth: { role: "officer", token } });

    socket.on("connect", () => {
      setSocketState(`Socket: đang hoạt động (${socket.id.slice(0, 6)})`, true);
      toast("Đang nhận thông báo trực tuyến.");
    });
    socket.on("disconnect", () => setSocketState("Socket: mất kết nối — đang thử lại…", false));
    socket.on("auth:error", (payload) => {
      setSocketState("Socket: phiên hết hạn", false);
      toast(payload?.error || "Phiên đăng nhập không hợp lệ.");
    });
    socket.on("officer:ready", (payload) => {
      if (payload?.counts) setBadge(payload.counts.pending || 0);
    });

    /* ------------------ ★ 3. Nhận "new-feedback" ------------------------ */
    socket.on("new-feedback", (payload) => {
      // payload: { feedback, submittedAt, wardName, emergency, submissionsFromDevice, unreadPending }
      console.log("[officer] Phản hồi mới:", payload);
      addFeedback(payload.feedback);
      setBadge(payload.unreadPending ?? countPending());
      toast(
        payload.emergency
          ? `🚨 KHẨN CẤP từ ${payload.feedback.wardName || payload.wardName}: ${payload.feedback.reason}`
          : `📩 Phản hồi mới từ ${payload.feedback.wardName || payload.wardName}`,
        payload.emergency,
      );
      alertUser(payload.emergency);
    });

    socket.on("feedback-reviewed", (payload) => {
      if (payload?.counts) setBadge(payload.counts.pending || 0);
      updateItemStatus(payload.feedbackId, payload.status);
    });

    socket.on("dashboard:counts", (counts) => setBadge(counts?.pending || 0));
  }

  $("loginBtn").addEventListener("click", async () => {
    const button = $("loginBtn");
    const errorBox = $("loginError");
    errorBox.hidden = true;
    button.disabled = true;

    const result = await api("/auth/login", {
      method: "POST",
      body: { username: $("username").value.trim(), password: $("password").value },
    });

    button.disabled = false;
    if (!result.ok) {
      errorBox.textContent = result.error || "Đăng nhập thất bại.";
      errorBox.hidden = false;
      return;
    }

    session.save({ token: result.token, user: result.user });
    await onLoggedIn();
  });

  $("logoutBtn").addEventListener("click", () => logout(false));

  function logout(expired) {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    session.clear();
    socket?.disconnect();
    socket = null;
    renderLoggedOut();
    if (expired) toast("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
  }

  async function onLoggedIn() {
    const user = session.get()?.user;
    $("whoami").textContent = `${user.displayName}${user.scopeName ? ` — ${user.scopeName}` : " — Cấp Tỉnh"}`;
    $("loginBtn").hidden = true;
    $("logoutBtn").hidden = false;
    $("password").value = "";
    await loadFeedbacks();
    connectSocket();
  }

  function renderLoggedOut() {
    $("whoami").textContent = "Chưa đăng nhập";
    $("loginBtn").hidden = false;
    $("logoutBtn").hidden = true;
    $("list").innerHTML = '<li style="color:#64748b;font-size:13px">Đăng nhập để xem phản hồi của địa bàn phụ trách.</li>';
    setBadge(0);
    setSocketState("Socket: chưa kết nối", false);
  }

  /* ------------------------------ Danh sách ------------------------------- */

  async function loadFeedbacks() {
    const result = await api("/feedbacks?status=pending");
    if (!result.ok) {
      $("list").innerHTML = `<li data-empty style="color:#b91c1c;font-size:13px">${escapeHtml(result.error || "Không tải được phản hồi.")}</li>`;
      return;
    }
    $("list").innerHTML = "";
    result.feedbacks.forEach((feedback) => addFeedback(feedback, { prepend: false }));
    if (!result.feedbacks.length) {
      $("list").innerHTML = '<li data-empty style="color:#64748b;font-size:13px">Chưa có phản hồi nào cần xử lý.</li>';
    }
    setBadge(result.counts?.pending || 0);
  }

  function addFeedback(feedback, { prepend = true } = {}) {
    if (!feedback) return;
    $("list").querySelector("li[data-empty]")?.remove();
    const existing = document.querySelector(`li[data-id="${CSS.escape(feedback.id)}"]`);
    if (existing) return;

    const li = document.createElement("li");
    li.dataset.id = feedback.id;
    li.className = prepend ? "fresh" : "";
    li.style.borderLeft = `4px solid ${TEAL}`;
    li.innerHTML = `
      <div class="head">
        <span class="who-name">${escapeHtml(feedback.fullName)}</span>
        <span class="pill" data-role="status">⏳ Chờ xác nhận</span>
        ${feedback.category === "khan_cap" ? '<span class="badge-emergency">KHẨN CẤP</span>' : ""}
      </div>
      <div class="content">${escapeHtml(feedback.reason)}</div>
      <div class="meta">
        ${escapeHtml(feedback.wardName || "")} · ${escapeHtml(feedback.hamlet || "")} ·
        📞 ${escapeHtml(feedback.phoneMasked || "***")} · ${escapeHtml(new Date(feedback.createdAt).toLocaleString("vi-VN"))}
      </div>
      <div class="actions">
        <button data-action="confirm">✅ Xác nhận</button>
        <button class="danger" data-action="reject">✖ Từ chối</button>
      </div>`;

    li.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "confirm") confirmFeedback(li, feedback);
      if (action === "reject") rejectFeedback(li, feedback);
    });

    const list = $("list");
    if (prepend) list.prepend(li);
    else list.append(li);
  }

  /* -------------------- 4. Xác nhận qua REST API -------------------------- */

  async function confirmFeedback(li, feedback) {
    if (li.dataset.busy) return;
    li.dataset.busy = "1";
    const button = li.querySelector('[data-action="confirm"]');
    button.disabled = true;

    const result = await api(`/feedbacks/${encodeURIComponent(feedback.id)}/confirm`, { method: "POST", body: {} });
    if (!result.ok) {
      button.disabled = false;
      li.dataset.busy = "";
      toast(result.error || "Không xác nhận được phản hồi.", true);
      return;
    }

    li.querySelector('[data-role="status"]').outerHTML = '<span class="pill approved" data-role="status">🟢 Đã xác nhận</span>';
    li.querySelector(".actions").innerHTML = '<span style="font-size:12px;color:#166534">Đã gửi thông báo tới người dân.</span>';
    li.classList.remove("fresh");
    toast("✅ Đã xác nhận — người dân nhận thông báo ngay lập tức.");
    setBadge(Math.max(countPending() - 1, 0));
    // Sự kiện "feedback-reviewed" cũng cập nhật badge; đếm lại từ DOM cho chắc chắn.
  }

  async function rejectFeedback(li, feedback) {
    const reason = window.prompt("Lý do từ chối (ít nhất 5 ký tự), người dân sẽ nhìn thấy:", "Thông tin chưa đủ để xác minh");
    // prompt() trả null khi người dùng bấm Huỷ; chuỗi rỗng -> lỗi (server cần >= 5 ký tự).
    if (reason === null) return;
    if (reason.trim().length < 5) {
      toast("Lý do từ chối phải có ít nhất 5 ký tự.", true);
      return;
    }

    const result = await api(`/feedbacks/${encodeURIComponent(feedback.id)}/reject`, {
      method: "POST",
      body: { reason },
    });
    if (!result.ok) {
      toast(result.error || "Không từ chối được phản hồi.", true);
      return;
    }
    li.querySelector('[data-role="status"]').outerHTML = '<span class="pill rejected" data-role="status">🔴 Từ chối</span>';
    li.querySelector(".actions").innerHTML = `<span style="font-size:12px;color:#991b1b">Lý do: ${escapeHtml(reason)}</span>`;
    toast("Đã từ chối và gửi lý do tới người dân.");
  }

  function updateItemStatus(feedbackId, status) {
    const li = document.querySelector(`li[data-id="${CSS.escape(feedbackId)}"]`);
    if (!li) return;
    if (status === "approved") li.remove();
  }

  /* ------------------------------ Tiện ích UI ----------------------------- */

  function countPending() {
    return document.querySelectorAll('#list li[data-id] [data-role="status"].pill:not(.approved):not(.rejected)').length;
  }

  function setBadge(count) {
    const badge = $("bellBadge");
    badge.textContent = String(count);
    badge.hidden = !count;
    document.title = count ? `(${count}) Cán bộ — Xác nhận phản hồi` : "Cán bộ — Xác nhận phản hồi thời gian thực";
    $("bell").setAttribute("aria-label", `Thông báo: ${count} mục`);
  }

  // Nhấp chuột vào chuông -> xin quyền thông báo hệ điều hành (nếu chưa có).
  $("bell").addEventListener("click", async () => {
    if (typeof Notification === "function" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    toast("Đang nhận thông báo trực tuyến qua Socket.io.");
  });

  function alertUser(urgent) {
    if (typeof Notification === "function" && Notification.permission === "granted") {
      try {
        new Notification(urgent ? "🚨 Phản hồi KHẨN CẤP" : "📩 Phản hồi mới", {
          body: "Mở trang cán bộ để xem và xác nhận.",
          tag: "khanhhoa-feedback",
        });
      } catch {
        /* trình duyệt chặn */
      }
    }
    // Âm thanh ngắn để không bỏ lỡ khi đang làm việc khác.
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = urgent ? 880 : 660;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      /* trình duyệt chặn tự phát âm thanh */
    }
    navigator.vibrate?.(urgent ? [200, 100, 200] : 120);
  }

  let toastTimer = null;
  function toast(message, urgent = false) {
    const el = $("toast");
    el.textContent = message;
    el.classList.toggle("urgent", Boolean(urgent));
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 6000);
  }

  function setSocketState(text, online) {
    const el = $("socketState");
    el.textContent = text;
    el.style.color = online ? "#0f766e" : "#b91c1c";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  /* -------------------------------- Khởi động ----------------------------- */

  if (session.get()?.token) onLoggedIn().catch(console.error);
  else renderLoggedOut();
})();
