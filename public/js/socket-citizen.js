/**
 * TRANG NGƯỜI DÂN — nhận thông báo "Đã xác nhận / Online" theo thời gian thực.
 *
 * Luồng:
 *  1. Kết nối Socket.io ngay khi mở trang (để không lỡ sự kiện sau khi gửi).
 *  2. Gửi phản hồi qua fetch POST /api/feedbacks.
 *  3. Server trả deviceToken -> đăng ký phòng riêng: socket.emit("citizen:subscribe").
 *  4. Khi cán bộ xác nhận, server bắn "feedback-confirmed" -> đổi badge + toast.
 *
 * Trong dự án thật chỉ cần 3 đoạn được đánh dấu ★.
 */
(() => {
  "use strict";

  const API = "/api";
  const $ = (id) => document.getElementById(id);

  /* ------------------------- ★ 1. Kết nối Socket.io ------------------------- */
  // deviceToken do khanhHoa-web.js giữ trong localStorage (mã thiết bị của người dân).
  const deviceToken = window.khanhHoa?.device?.get?.() || localStorage.getItem("khanhhoa.web.deviceToken");

  const socket = io({
    auth: { deviceToken },
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    setSocketState(`Socket: đã kết nối (${socket.id.slice(0, 6)})`, true);
    // Đăng ký phòng riêng của thiết bị để nhận đúng sự kiện xác nhận.
    socket.emit("citizen:subscribe", { deviceToken: deviceToken || undefined }, (ack) => {
      if (!ack?.ok) return;
      console.log("[citizen] Đã vào phòng thiết bị", ack);
    });
  });

  socket.on("disconnect", () => setSocketState("Socket: mất kết nối — đang thử lại…", false));
  socket.io.on("reconnect_attempt", () => setSocketState("Socket: đang kết nối lại…", false));

  /* --------------- ★ 2. Nhận sự kiện "feedback-confirmed" ------------------ */
  socket.on("feedback-confirmed", (payload) => {
    // payload: { feedbackId, status, statusLabel, reviewNote, reviewedAt, reviewedBy, wardName, feedback }
    console.log("[citizen] Cán bộ đã xác nhận:", payload);
    markConfirmed(payload.feedbackId, payload);
    loadMyFeedbacks().catch(console.error);
    showToast(`✅ Phản hồi đã được xác nhận — Đã xác nhận / Online${payload.wardName ? ` (${payload.wardName})` : ""}`);
    if (payload.reviewNote) {
      setTimeout(() => showToast(`💬 Ghi chú từ cán bộ: ${payload.reviewNote}`), 1600);
    }
  });

  // Cán bộ từ chối -> hiện lý do (tùy chọn).
  socket.on("feedback-rejected", (payload) => {
    markRejected(payload.feedbackId, payload.reason);
    showToast(`⚠️ Phản hồi bị từ chối: ${payload.reason}`);
  });

  /* --------------------- Gửi phản hồi qua REST API -------------------------- */
  $("feedbackForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("submitBtn");
    const errorBox = $("formError");
    errorBox.hidden = true;
    button.disabled = true;

    const body = Object.fromEntries(new FormData(form).entries());
    body.lat = Number(body.lat);
    body.lng = Number(body.lng);

    try {
      const response = await fetch(`${API}/feedbacks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("khanhhoa.web.deviceToken")
            ? { "X-Device-Token": localStorage.getItem("khanhhoa.web.deviceToken") }
            : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        errorBox.textContent = (result.errors || [result.error || "Không gửi được phản hồi."]).join("\n");
        errorBox.hidden = false;
        return;
      }

      // Server cấp/giữ mã thiết bị -> lưu lại và đăng ký phòng (nếu chưa kịp ở bước 1).
      if (result.deviceToken) {
        localStorage.setItem("khanhhoa.web.deviceToken", result.deviceToken);
        window.khanhHoa?.device?.set?.(result.deviceToken);
        socket.emit("citizen:subscribe", { deviceToken: result.deviceToken });
      }

      prependFeedback(result.feedback);
      showToast(result.message || "Đã gửi phản hồi tới cán bộ.");
      form.reset();
      $("phone").value = "0905123456";
      $("email").value = "an.nguyen@example.com";
      $("address").value = "12 Trần Phú";
      $("reason").value = "Cần hỗ trợ gạo và nước uống cho 5 hộ gia đình khó khăn trong tổ dân phố.";
    } catch (error) {
      errorBox.textContent = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  /* ------------------------------- Giao diện -------------------------------- */

  function setSocketState(text, online) {
    const el = $("socketState");
    el.textContent = text;
    el.style.color = online ? "#ccfbf1" : "#fecaca";
  }

  const STATUS = {
    pending: { cls: "waiting", label: "⏳ Chờ cán bộ xác nhận" },
    approved: { cls: "confirmed", label: "🟢 Đã xác nhận / Online" },
    rejected: { cls: "rejected", label: "🔴 Từ chối" },
  };

  function badge(status, label) {
    const item = STATUS[status] || STATUS.pending;
    return `<span class="pill ${item.cls}"><span class="dot"></span>${escapeHtml(label || item.label)}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function prependFeedback(feedback) {
    const list = $("myFeedbacks");
    list.querySelector(".meta")?.remove();
    const li = document.createElement("li");
    li.dataset.feedbackId = feedback.id;
    li.innerHTML = `
      <div class="status" data-role="status">${badge(feedback.status)}</div>
      <div class="content">${escapeHtml(feedback.reason)}</div>
      <div class="meta">${escapeHtml(feedback.wardName || "")} · ${escapeHtml(new Date(feedback.createdAt).toLocaleString("vi-VN"))}</div>
      <div class="meta" data-role="note"></div>`;
    list.prepend(li);
    notify("Thông báo", "📬 Đã gửi phản hồi tới cán bộ phường/xã.");
  }

  /** Thông báo cả trên trang (giữ lịch sử) và hộp thông báo của hệ điều hành. */
  function notify(title, body) {
    showToast(body);
    if (typeof Notification === "function" && Notification.permission === "granted") {
      try {
        new Notification(title, { body, icon: "/favicon.ico" });
      } catch {
        /* trình duyệt chặn thông báo hệ thống -> toast vẫn hiển thị */
      }
    }
  }

  function markConfirmed(feedbackId, payload) {
    const li = document.querySelector(`li[data-feedback-id="${CSS.escape(feedbackId)}"]`);
    if (!li) return;
    li.querySelector('[data-role="status"]').innerHTML = badge("approved", payload.statusLabel || "Đã xác nhận / Online");
    if (payload.reviewNote) li.querySelector('[data-role="note"]').textContent = `Ghi chú: ${payload.reviewNote}`;
    li.classList.add("flash");
    notify("Phản hồi đã xác nhận", `Đã xác nhận / Online — ${payload.wardName || ""}`.trim());
  }

  function markRejected(feedbackId, reason) {
    const li = document.querySelector(`li[data-feedback-id="${CSS.escape(feedbackId)}"]`);
    if (!li) return;
    li.querySelector('[data-role="status"]').innerHTML = badge("rejected", "Từ chối");
    li.querySelector('[data-role="note"]').textContent = `Lý do: ${reason || ""}`;
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
  }

  /* ------------------------- Nạp danh mục + phản hồi cũ -------------------- */

  async function loadOptions() {
    const directory = await fetch(`${API}/regions`).then((r) => r.json());
    if (!directory.ok) return;

    $("category").innerHTML = directory.categories
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.icon)} ${escapeHtml(item.label)}</option>`)
      .join("");

    const wards = directory.regions.flatMap((district) => district.wards);
    $("wardId").innerHTML = wards
      .map((ward) => `<option value="${escapeHtml(ward.wardId)}">${escapeHtml(ward.wardName)}</option>`)
      .join("");

    const syncHamlets = () => {
      const ward = wards.find((item) => item.wardId === $("wardId").value);
      $("hamlet").innerHTML = (ward?.hamlets || [])
        .map((hamlet) => `<option value="${escapeHtml(hamlet)}">${escapeHtml(hamlet)}</option>`)
        .join("");
    };
    $("wardId").addEventListener("change", syncHamlets);
    syncHamlets();
  }

  async function loadMyFeedbacks() {
    const response = await fetch(`${API}/my-feedbacks`, { credentials: "same-origin" });
    const result = await response.json().catch(() => ({ ok: false }));
    if (!result.ok || !result.feedbacks?.length) return;
    $("myFeedbacks").innerHTML = "";
    // Server trả mới nhất trước; prepend để đúng thứ tự.
    [...result.feedbacks].reverse().forEach((feedback) => prependFeedback(feedback));
  }

  loadOptions().catch(console.error);
  loadMyFeedbacks().catch(console.error);
})();
