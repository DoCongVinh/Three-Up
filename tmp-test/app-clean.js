/**
 * Renderer (Electron) - Bản đồ Yêu thương Khánh Hòa.
 *
 * Nguyên tắc:
 *  - KHÔNG dùng innerHTML với dữ liệu: mọi nội dung động tạo bằng createElement
 *    + textContent -> miễn nhiễm XSS (đã có test).
 *  - Mọi thao tác dữ liệu đi qua window.khanhHoa.request(channel, payload).
 *    Nếu chạy trong trình duyệt thường (không có preload), dùng khanhHoaWeb()
 *    (localStorage) để vẫn xem được, nhưng tính năng quản trị bị khóa.
 *  - Trạng thái phiên giữ trong main process; renderer chỉ lưu user + sessionId.
 */

/* global L, khanhHoaWeb */
(() => {
  "use strict";

  /* ================================ Constants ============================== */

  const STATUS_LABELS = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" };
  /** Nhóm thông tin dự phòng (dữ liệu thật lấy từ db.json qua regions:units). */
  const DEFAULT_CATEGORIES = {
    ho_tro: { label: "Điểm hỗ trợ", icon: "🍲", color: "#15803d" },
    chinh_sach: { label: "Chính sách & Quyền lợi", icon: "📜", color: "#7c3aed" },
    nhu_cau: { label: "Nhu cầu thực tế", icon: "🤝", color: "#ea580c" },
    khan_cap: { label: "Thông tin khẩn cấp", icon: "🚨", color: "#dc2626" },
  };

  /**
   * Nhóm thông tin đang dùng = state.categories, dạng map để truy cập CATEGORIES[id].
   * Admin thêm nhóm mới -> nạp lại -> form phản hồi, bộ lọc, chú giải đều đổi theo.
   */
  const CATEGORIES = new Proxy({}, {
    get(_target, prop) {
      const list = state.categories && state.categories.length ? state.categories : null;
      if (list) {
        const found = list.find((item) => item.id === prop);
        if (found) return { label: found.label, icon: found.icon, color: found.color };
        return undefined;
      }
      return DEFAULT_CATEGORIES[prop];
    },
    ownKeys() {
      return state.categories && state.categories.length
        ? state.categories.map((item) => item.id)
        : Object.keys(DEFAULT_CATEGORIES);
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
  const PROVINCE_CENTER = [12.05, 109.15];
  const PROVINCE_ZOOM = 9;
  const MAX_IMAGES = 5;

  /**
   * Danh mục dự phòng khi chưa nạp được từ main (chế độ web / mất kết nối).
   * Dữ liệu thật lấy từ db.json qua kênh regions:units; giữ ở đây dạng 2 tầng
   * (huyện -> xã/phường + hamlets) để UI dùng chung một cấu trúc.
   */
  const FALLBACK_UNITS = [
  {
    districtId: "nha_trang",
    districtName: "Thành phố Nha Trang",
    shortName: "Nha Trang",
    wards: [
      {
        wardId: "p_nha_trang",
        wardName: "Phường Nha Trang",
        oldUnits: "Sáp nhập các phường Vạn Thạnh, Lộc Thọ, Vĩnh Nguyên, Tân Tiến, Phước Hòa",
        hamlets: ["Tổ 1 Vạn Thạnh", "Tổ 2 Lộc Thọ", "Tổ 3 Vĩnh Nguyên", "Tổ 4 Tân Tiến", "Tổ 5 Phước Hòa"],
      },
      {
        wardId: "p_bac_nha_trang",
        wardName: "Phường Bắc Nha Trang",
        oldUnits: "Sáp nhập các phường Vĩnh Hòa, Vĩnh Hải, Vĩnh Phước, Vĩnh Thọ, xã Vĩnh Lương, Vĩnh Phương",
        hamlets: ["Tổ 1 Vĩnh Hòa", "Tổ 2 Vĩnh Hải", "Tổ 3 Vĩnh Phước", "Thôn Văn Đăng", "Thôn Võ Cạnh"],
      },
      {
        wardId: "p_tay_nha_trang",
        wardName: "Phường Tây Nha Trang",
        oldUnits: "Sáp nhập Ngọc Hiệp, Phương Sài, Vĩnh Ngọc, Vĩnh Thạnh, Vĩnh Hiệp, Vĩnh Trung",
        hamlets: ["Tổ 1 Ngọc Hiệp", "Tổ 2 Phương Sài", "Thôn Phú Vinh", "Thôn Lương Nhơn", "Thôn Đạ Lộc"],
      },
      {
        wardId: "p_nam_nha_trang",
        wardName: "Phường Nam Nha Trang",
        oldUnits: "Sáp nhập Phước Hải, Phước Long, Vĩnh Trường, xã Vĩnh Thái, Phước Đồng",
        hamlets: ["Tổ 1 Phước Hải", "Tổ 2 Phước Long", "Thôn Thủy Tú", "Thôn Phước Lộc", "Tổ 3 Vĩnh Trường"],
      },
    ],
  },
  {
    districtId: "cam_ranh",
    districtName: "Thành phố Cam Ranh",
    shortName: "Cam Ranh",
    wards: [
      {
        wardId: "p_cam_linh",
        wardName: "Phường Cam Linh",
        oldUnits: "Sáp nhập phường Cam Thuận, Cam Lợi và Cam Linh",
        hamlets: ["Tổ dân phố 1", "Tổ dân phố 2", "Tổ dân phố 3", "Tổ dân phố 4", "Tổ dân phố 5"],
      },
      {
        wardId: "p_cam_ranh",
        wardName: "Phường Cam Ranh",
        oldUnits: "Sáp nhập phường Cam Phú, Cam Lộc và Cam Phúc Nam",
        hamlets: ["Tổ 1 Cam Phú", "Tổ 2 Cam Lộc", "Tổ 3 Cam Phúc Nam"],
      },
      {
        wardId: "p_bac_cam_ranh",
        wardName: "Phường Bắc Cam Ranh",
        oldUnits: "Sáp nhập phường Cam Nghĩa, Cam Phúc Bắc và xã Cam Thành Nam",
        hamlets: ["Tổ 1 Cam Nghĩa", "Tổ 2 Cam Phúc Bắc", "Thôn Tân Lập"],
      },
      {
        wardId: "p_ba_ngoi",
        wardName: "Phường Ba Ngòi",
        oldUnits: "Sáp nhập phường Ba Ngòi và xã Cam Phước Đông",
        hamlets: ["Tổ 1 Ba Ngòi", "Thôn A Tai", "Thôn Hiệp Hòa"],
      },
      {
        wardId: "x_nam_cam_ranh",
        wardName: "Xã Nam Cam Ranh",
        oldUnits: "Sáp nhập xã Cam Lập, Cam Bình, Cam Thịnh Đông và Cam Thịnh Tây",
        hamlets: ["Thôn Bình Ba", "Thôn Bình Hưng", "Thôn Nước Ngọt", "Thôn Cam Lập"],
      },
    ],
  },
  {
    districtId: "ninh_hoa",
    districtName: "Thị xã Ninh Hòa",
    shortName: "Ninh Hòa",
    wards: [
      {
        wardId: "p_ninh_hoa",
        wardName: "Phường Ninh Hòa",
        oldUnits: "Sáp nhập Ninh Hiệp, Ninh Đa, Ninh Đông, Ninh Phụng",
        hamlets: ["Tổ 1 Ninh Hiệp", "Tổ 2 Ninh Đa", "Thôn Quảng Cư"],
      },
      {
        wardId: "p_dong_ninh_hoa",
        wardName: "Phường Đông Ninh Hòa",
        oldUnits: "Sáp nhập Ninh Diêm, Ninh Hải, Ninh Thủy, Ninh Phước",
        hamlets: ["Tổ 1 Ninh Diêm", "Tổ 2 Ninh Hải", "Thôn Mỹ Giang"],
      },
      {
        wardId: "p_hoa_thang",
        wardName: "Phường Hòa Thắng",
        oldUnits: "Sáp nhập Ninh Giang, Ninh Hà và xã Ninh Phú",
        hamlets: ["Tổ 1 Ninh Giang", "Tổ 2 Ninh Hà", "Thôn Tiên Du"],
      },
      {
        wardId: "x_bac_ninh_hoa",
        wardName: "Xã Bắc Ninh Hòa",
        oldUnits: "Sáp nhập Ninh An, Ninh Sơn, Ninh Thọ",
        hamlets: ["Thôn Lạc An", "Thôn Lạc Sơn", "Thôn Lạc Bình"],
      },
    ],
  },
  {
    districtId: "cam_lam",
    districtName: "Huyện Cam Lâm",
    shortName: "Cam Lâm",
    wards: [
      {
        wardId: "x_cam_lam",
        wardName: "Xã Cam Lâm",
        oldUnits: "Sáp nhập TT. Cam Đức, Cam Hải Đông, Cam Hải Tây, Cam Thành Bắc...",
        hamlets: ["Tổ 1 Cam Đức", "Thôn Bãi Dài", "Thôn Cam Hải"],
      },
      {
        wardId: "x_suoi_dau",
        wardName: "Xã Suối Dầu",
        oldUnits: "Sáp nhập xã Suối Cát và một phần Cam Hòa, Cam Tân, Suối Tân",
        hamlets: ["Thôn Suối Cát", "Thôn Tân Lập", "Thôn Tân Hải"],
      },
    ],
  },
  {
    districtId: "truong_sa",
    districtName: "Huyện Trường Sa",
    shortName: "Trường Sa",
    wards: [
      {
        wardId: "dk_truong_sa",
        wardName: "Đặc khu Trường Sa",
        oldUnits: "Sáp nhập thị trấn Trường Sa, xã Song Tử Tây và xã Sinh Tồn",
        hamlets: ["Đảo Trường Sa Lớn", "Đảo Song Tử Tây", "Đảo Sinh Tồn"],
      },
    ],
  },
];

  const FALLBACK_REGIONS = FALLBACK_UNITS.map((district) => ({
    id: district.districtId,
    name: district.districtName,
    shortName: district.shortName || district.districtName,
    type: "area",
    center: null,
    wards: district.wards.map((ward) => ({
      id: ward.wardId,
      name: ward.wardName,
      legacy: ward.oldUnits,
      hamlets: ward.hamlets,
      regionId: district.districtId,
    })),
  }));

  /* ================================= Helpers =============================== */

  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };
  /**
   * Ẩn/hiện một khối. Dùng cả attribute `hidden` (để CSS/aria đúng) lẫn class
   * `hidden` của Tailwind (để thắng các class `flex`/`grid` đang có sẵn).
   */
  const setHidden = (node, hidden) => {
    if (!node) return;
    const isHidden = Boolean(hidden);
    if (isHidden) node.setAttribute("hidden", "");
    else node.removeAttribute("hidden");
    node.classList.toggle("hidden", isHidden);
  };
  const show = (node) => setHidden(node, false);
  const hide = (node) => setHidden(node, true);

  function showMessage(node, text, tone = "error") {
    if (!node) return;
    node.textContent = text;
    node.className = `rounded-xl p-3 text-sm ${tone === "success"
      ? "bg-emerald-50 text-emerald-800"
      : tone === "info" ? "bg-teal-50 text-teal-800" : "bg-red-50 text-red-800"}`;
    show(node);
  }

  function hideMessage(node) {
    if (!node) return;
    node.textContent = "";
    hide(node);
  }

  let toastTimer = 0;
  function toast(text) {
    const node = $("toast");
    node.textContent = text;
    show(node);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hide(node), 3200);
  }

  const wardLabel = (id) => {
    for (const region of state.regions) {
      const ward = region.wards.find((item) => item.id === id);
      if (ward) return ward.name;
    }
    return "Chưa xác định";
  };
  const regionLabel = (id) => state.regions.find((region) => region.id === id)?.name || "";
  const formatTime = (iso) => {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  };

  /* ================================== State ================================ */

  const state = {
    sessionId: null,
    user: null,
    regions: [],
    locations: [],
    markers: new Map(),
    activeCategory: "all",
    filters: { regionId: "all", wardId: "all" },
    view: "map",
    feedback: { list: [], selected: null, status: "pending", counts: {} },
    accounts: [],
    directory: [],
    directory_selected: null,
    categories: [],
    editingCategory: null,
    notifications: [],
    unread: 0,
    emergencyUnread: 0,
    mapReady: false,
    baseLayer: null,
    pendingImages: [],
    pickingOnMap: false,
    tempMarker: null,
    booted: false,
  };

  const isAdmin = () => state.user?.role === "admin";
  const isWard = () => state.user?.role === "ward";
  const isDesktop = () => Boolean(window.khanhHoa?.isDesktop);

  /* ================================= Transport ============================= */

  async function api(channel, payload = {}) {
    try {
      return await window.khanhHoa.request(channel, payload);
    } catch (error) {
      return { ok: false, code: "IPC", errors: [error?.message || "Không gọi được tiến trình chính."] };
    }
  }

  function firstError(result, fallback = "Có lỗi xảy ra.") {
    return (Array.isArray(result?.errors) && result.errors[0]) || fallback;
  }

  /* ================================== Login ================================ */

  async function handleLogin(event) {
    event?.preventDefault();
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    const errorBox = $("loginError");
    hideMessage(errorBox);

    if (!username || !password) {
      showMessage(errorBox, "Vui lòng nhập tên đăng nhập và mật khẩu.");
      return;
    }
    const button = $("loginSubmit");
    button.disabled = true;
    const result = await api("auth:login", { username, password });
    button.disabled = false;

    if (!result.ok) {
      showMessage(errorBox, firstError(result, "Đăng nhập thất bại."));
      $("loginPassword").value = "";
      return;
    }
    state.sessionId = result.sessionId;
    state.user = result.user;
    $("loginPassword").value = "";
    showAppView();
    if (result.mustChangePassword) {
      toast("Tài khoản đang dùng mật khẩu tạm. Hãy đổi mật khẩu trong mục Tài khoản.");
    }
  }

  async function handleLogout() {
    if (state.sessionId) await api("auth:logout", { sessionId: state.sessionId });
    state.sessionId = null;
    state.user = null;
    state.pendingImages = [];
    clearMarkers();
    renderLocations([]);
    showView("login");
    $("loginForm").reset();
    hideMessage($("loginError"));
  }

  /* ============================ View switching ============================= */

  /**
   * Tab -> container nội dung. Mọi container được liệt kê ở đây đều bị ẩn trước,
   * sau đó chỉ container của tab được chọn được hiển thị.
   * Tab "map" dùng chung #appView (sidebar + #map) và cần map.invalidateSize().
   */
  const VIEWS = Object.freeze({
    map: { container: "mapView", adminOnly: false },
    feedback: { container: "feedbackView", adminOnly: false },
    directory: { container: "directoryView", adminOnly: false },
    accounts: { container: "accountsView", adminOnly: true },
  });

  /** Ẩn/hiện view (login vs workspace). Chỉ xử lý các khối cấp cao, không đụng tới tab. */
  function showView(view) {
    // #loginView và #appView là hai view cấp cao nhất; cả 4 container tab đều
    // nằm BÊN TRONG #appView nên không được ẩn #appView theo tab.
    const loggedIn = view !== "login";
    setHidden($("loginView"), loggedIn);
    setHidden($("appView"), !loggedIn);
    if (loggedIn) {
      // Vào workspace: hiện đúng tab được yêu cầu (mặc định "map").
      const target = VIEWS[view] ? view : "map";
      setTabPanels(target);
      state.view = target;
    }
    return Boolean(VIEWS[view]);
  }

  /** Ẩn TẤT CẢ panel rồi chỉ hiện panel của tab được chọn. */
  function setTabPanels(view) {
    for (const [name, config] of Object.entries(VIEWS)) {
      if (name === view) show($(config.container));
      else hide($(config.container));
    }
  }

  /**
   * Chuyển tab: ẩn mọi container khác, hiện container tương ứng, cập nhật trạng thái
   * active trên header và canh lại kích thước Leaflet khi quay về bản đồ.
   */
  async function openView(view) {
    const config = VIEWS[view];
    if (!config) return;
    if (config.adminOnly && !isAdmin()) return;

    // Mọi tab cần danh mục phường/xã (form, bộ lọc) -> bảo đảm đã nạp.
    await ensureWardsLoaded();

    // Chuyển tab = ẩn mọi panel khác + hiện panel này + cập nhật header.
    showView(view);
    highlightTab(view);
    if (view === "map") {
      // Phản hồi có thể vừa được duyệt ở tab khác -> nạp lại ghim.
      await loadLocations();
      // Container vừa từ hidden -> hiển thị: Leaflet phải đo lại kích thước,
      // nếu không bản đồ sẽ bị xám/ô vuông lệch khung.
      refreshMapSize();
      return;
    }
    if (view === "feedback") await loadQueue();
    if (view === "directory") await loadDirectory();
    if (view === "accounts") {
      // Nạp lại danh mục (địa bàn + nhóm thông tin) rồi nạp tài khoản.
      try {
        await loadRegions();
        buildRegionSelects();
      } catch (error) {
        console.error("[accounts] không nạp được danh mục:", error);
      }
      await loadAccounts();
      // Đổ lại danh sách phường/xã sau khi đã có danh mục + danh sách tài khoản
      // (để gợi ý tên đăng nhập tránh trùng).
      rebuildAccountWards();
      if (!state.accounts.length) {
        $("accountWardHint").textContent = "Chọn Phường/Xã để tạo tài khoản cho đúng địa bàn.";
      }
    }
  }

  /** Gọi map.invalidateSize() sau khi frame đã layout lại (an toàn khi map chưa tạo). */
  function refreshMapSize() {
    if (!map) return;
    const doResize = () => {
      const container = map.getContainer ? map.getContainer() : null;
      // Container đang ẩn (display:none) -> kích thước 0x0; đo lúc này sẽ làm
      // bản đồ bị xám. Chờ tab hiển thị xong mới invalidate.
      if (container && (container.offsetWidth === 0 || container.offsetHeight === 0)) return;
      map.invalidateSize({ animate: false });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(doResize);
    else setTimeout(doResize, 0);
    // Thêm một lần sau khi transition/layout ổn định (một số GPU driver trễ 1 frame).
    setTimeout(doResize, 150);
  }

  async function showAppView() {
    // Trạng thái tab mặc định: bản đồ. Show/hide + active header chạy ngay,
    // không chờ dữ liệu (tránh màn hình trắng khi mạng/IO chậm); cán bộ được
    // chuyển sang hàng đợi ở cuối hàm.
    showView("map");
    highlightTab("map");
    const name = state.user?.displayName || "";
    $("currentUserName").textContent = name;
    const scope = state.user?.role === "ward" ? state.user.scopeName : "Toàn tỉnh Khánh Hòa";
    const roleText = isGuest()
      ? "Chế độ khách · Chỉ xem"
      : state.user?.role === "admin" ? "Cấp Tỉnh · Quản trị tổng" : "Cán bộ " + scope;
    $("currentUserRole").textContent = roleText;
    $("titleBarScope").textContent = isGuest()
      ? "Xem bản đồ công khai (không đăng nhập)"
      : state.user?.role === "admin" ? "Cấp Tỉnh · Quản trị tổng" : "Địa bàn: " + scope;
    // Admin-only tab + đăng xuất chỉ có ý nghĩa khi đã đăng nhập thật.
    for (const node of document.querySelectorAll("[data-admin-only]")) setHidden(node, !isAdmin());
    setHidden($("logoutButton"), isGuest());

    await loadRegions();
    buildRegionSelects();
    // Cán bộ vào thẳng hàng đợi phản hồi của mình (quyết định trước khi nạp dữ liệu).
    const landing = isWard() ? "feedback" : "map";
    await Promise.all([loadLocations(), loadQueueCounts()]);
    refreshMapSize();
    // Thông báo: nạp ngay + đồng bộ định kỳ (bắt cảnh báo khẩn cấp mới).
    await loadNotifications();
    startNotificationPolling();
    if (landing === "feedback") await openView("feedback");
  }

  /* ================================== Tabs ================================= */

  const VIEW_BUTTONS = () => Array.from(document.querySelectorAll("[data-view]"));

  const ACTIVE_TAB_CLASSES = ["bg-white", "text-teal-800", "shadow-sm", "ring-1", "ring-teal-200"];
  const IDLE_TAB_CLASSES = ["text-slate-600"];

  /** Đánh dấu đúng 1 nút header là active (aria-selected + class + data-active). */
  function highlightTab(view) {
    for (const button of VIEW_BUTTONS()) {
      const active = button.dataset.view === view;
      for (const name of ACTIVE_TAB_CLASSES) button.classList.toggle(name, active);
      for (const name of IDLE_TAB_CLASSES) button.classList.toggle(name, !active);
      button.classList.toggle("tab-active", active);
      if (active) button.dataset.active = "true";
      else delete button.dataset.active;
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  /* ================================= Regions =============================== */

  async function loadRegions() {
    // Lấy danh mục 3 tầng (huyện -> xã/phường -> thôn/tổ) làm nguồn duy nhất
    // cho bộ lọc bản đồ, form phản hồi và form tạo tài khoản.
    const units = await api("regions:units");
    // Nhóm thông tin đi kèm cùng kênh -> nạp luôn (kể cả khi đơn vị hành chính lỗi).
    if (units.ok && Array.isArray(units.categories)) state.categories = units.categories;
    if (!units.ok) {
      const cats = await api("categories:list");
      if (cats.ok) state.categories = cats.categories;
    }
    if (units.ok && Array.isArray(units.units) && units.units.length) {
      state.units = units.units;
      state.regions = units.units.map((district) => ({
        id: district.districtId,
        name: district.districtName,
        shortName: district.shortName || district.districtName,
        type: "area",
        center: district.center || DISTRICT_CENTERS[district.districtId] || null,
        wards: district.wards.map((ward) => ({
          id: ward.wardId,
          name: ward.wardName,
          legacy: ward.oldUnits,
          hamlets: ward.hamlets,
          regionId: district.districtId,
        })),
      }));
      return;
    }
    const result = await api("directory:regions");
    state.regions = result.ok && Array.isArray(result.regions) && result.regions.length ? result.regions : FALLBACK_REGIONS;
    state.units = [];
  }

  /** Thôn/tổ dân phố của một phường/xã (rỗng nếu không tìm thấy). */
  function hamletsOf(wardId) {
    for (const region of state.regions) {
      const ward = region.wards.find((item) => item.id === wardId);
      if (ward) return ward.hamlets || [];
    }
    return [];
  }

  const allWards = (regionId = "all") =>
    state.regions
      .filter((region) => regionId === "all" || region.id === regionId)
      .flatMap((region) => region.wards.map((ward) => ({ ...ward, regionId: region.id, regionName: region.name })));

  function fillSelect(select, items, { valueKey = "id", labelKey = "name", allLabel = null, selected = "" } = {}) {
    clear(select);
    if (allLabel) {
      const option = el("option", "", allLabel);
      option.value = "all";
      select.appendChild(option);
    }
    for (const item of items) {
      const option = el("option", "", item[labelKey]);
      option.value = item[valueKey];
      select.appendChild(option);
    }
    if (selected) select.value = selected;
    if (!select.value && select.options.length) select.selectedIndex = 0;
  }

  function buildRegionSelects() {
    const regions = state.regions.map((region) => ({ id: region.id, name: region.name }));
    // Bộ lọc bản đồ: chỉ còn dropdown phường/xã phẳng (không còn bậc khu vực).
    rebuildWardFilter();
    // Form gửi phản hồi: danh sách phẳng tất cả phường/xã, nhóm theo khu vực.
    rebuildFeedbackWards();
    // Tạo tài khoản: chọn trực tiếp phường/xã.
    rebuildAccountWards();
    // Lọc danh sách tài khoản theo phường/xã
    rebuildAccountFilter();
    // Nhóm thông tin (có thể vừa được admin thêm/sửa/xoá)
    rebuildCategoryUI();
  }

  /** Gán khu vực của một phường/xã (dùng cho <optgroup> và payload). */
  function regionIdOfWard(wardId) {
    const region = state.regions.find((item) => item.wards.some((ward) => ward.id === wardId));
    return region ? region.id : "";
  }

  /**
   * Đổ danh sách phẳng mọi phường/xã vào một <select>.
   * Dùng <optgroup> để nhóm theo khu vực — nếu trình duyệt không hỗ trợ
   * (hoặc optgroup rỗng) thì vẫn phải hiện option để người dân chọn được.
   */
  function fillWardSelect(select, { allLabel = null, placeholder = null, selected = "" } = {}) {
    clear(select);
    if (placeholder) {
      const option = el("option", "", placeholder);
      option.value = "";
      select.appendChild(option);
    }
    if (allLabel) {
      const option = el("option", "", allLabel);
      option.value = "all";
      select.appendChild(option);
    }
    for (const region of state.regions) {
      const wards = Array.isArray(region.wards) ? region.wards : [];
      if (!wards.length) continue;
      const group = document.createElement("optgroup");
      // setAttribute (không dùng property) để chắc chắn label được ghi vào DOM.
      group.setAttribute("label", region.name || "");
      for (const ward of wards) {
        const option = el("option", "", ward.name);
        option.value = ward.id;
        group.appendChild(option);
      }
      select.appendChild(group);
    }
    if (selected) select.value = selected;
    if (allLabel && !selected) select.value = "all";
  }

  /* ----------------------- Nhóm thông tin (động) ----------------------- */

  /** Bộ icon gợi ý cho nhóm thông tin (bấm chọn khi tạo/sửa nhóm). */
  const CATEGORY_ICONS = [
    "🍲", "📜", "🤝", "🚨", "♿", "🎖️", "🧓", "👶", "🏥", "💊", "🩺", "🦽", "👁️", "🧠", "❤️", "🫀",
    "🏫", "📚", "🎒", "🍚", "💧", "🏠", "🏚️", "🔥", "🌊", "⛈️", "🤱", "👨‍👩‍👧", "🧑‍🌾", "🧑‍💼", "🏛️", "📋",
    "💼", "🚌", "🛠️", "⚡", "🚰", "🚦", "📞", "📍", "🆘", "🕊️", "🌈", "🎗️",
  ];

  /** Vẽ lưới icon; icon đang chọn được viền xanh. */
  function renderIconPicker() {
    const box = $("iconPicker");
    if (!box) return;
    clear(box);
    const selected = $("categoryIcon").value.trim();
    for (const icon of CATEGORY_ICONS) {
      const button = el("button", "grid h-8 w-8 place-items-center rounded-lg text-lg transition hover:bg-slate-100 " +
        (icon === selected ? "bg-teal-100 ring-2 ring-teal-500" : ""));
      button.type = "button";
      button.dataset.icon = icon;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(icon === selected));
      button.setAttribute("aria-label", "Biểu tượng " + icon);
      button.textContent = icon;
      button.addEventListener("click", () => {
        $("categoryIcon").value = icon;
        renderIconPicker();
        updateCategoryPreview();
      });
      box.appendChild(button);
    }
  }

  const categoryList = () => (state.categories && state.categories.length ? state.categories : Object.entries(DEFAULT_CATEGORIES).map(([id, item]) => ({ id, ...item })));

  /** Vẽ lại: chip lọc bản đồ, dropdown trong form phản hồi, danh sách quản lý của admin. */
  function rebuildCategoryUI() {
    const list = categoryList();
    renderCategoryChips(list);
    renderCategoryOptions(list);
    renderCategoryAdminList(list);
    renderMapLegend();
  }

  function renderCategoryChips(list) {
    const box = $("categoryFilters");
    if (!box) return;
    // Giữ lại chip "Tất cả" đầu tiên, dựng lại các chip còn lại theo danh mục.
    clear(box);
    const all = el("button", "category-button rounded-full border px-3 py-1.5 text-xs font-semibold", "📋 Tất cả");
    all.type = "button";
    all.dataset.category = "all";
    box.appendChild(all);
    for (const item of list) {
      const chip = el("button", "category-button rounded-full border px-3 py-1.5 text-xs font-semibold", item.icon + " " + item.label);
      chip.type = "button";
      chip.dataset.category = item.id;
      box.appendChild(chip);
    }
    // Nếu nhóm đang lọc vừa bị xoá -> quay về "Tất cả".
    if (state.activeCategory !== "all" && !list.some((item) => item.id === state.activeCategory)) {
      state.activeCategory = "all";
    }
    for (const chip of box.querySelectorAll(".category-button")) {
      const active = chip.dataset.category === state.activeCategory;
      chip.classList.toggle("bg-teal-700", active);
      chip.classList.toggle("border-teal-700", active);
      chip.classList.toggle("text-white", active);
      chip.classList.toggle("bg-white", !active);
      chip.classList.toggle("border-slate-200", !active);
      chip.classList.toggle("text-slate-700", !active);
    }
  }

  function renderCategoryOptions(list) {
    const select = $("feedbackForm") && $("feedbackForm").elements.category;
    if (!select) return;
    const current = select.value;
    clear(select);
    for (const item of list) {
      const option = el("option", "", item.icon + " " + item.label);
      option.value = item.id;
      select.appendChild(option);
    }
    if (list.some((item) => item.id === current)) select.value = current;
    else if (list.length) select.selectedIndex = 0;
  }

  function renderCategoryAdminList(list) {
    const box = $("categoryAdminList");
    if (!box) return;
    clear(box);
    for (const item of list) {
      const card = el("div", "flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2");
      const left = el("div", "flex min-w-0 items-center gap-2");
      const badge = el("span", "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base", item.icon);
      badge.style.background = item.color + "22";
      const info = el("div", "min-w-0");
      info.appendChild(el("p", "truncate text-sm font-semibold text-slate-800", item.label));
      info.appendChild(el("p", "truncate text-[11px] text-slate-500", item.id));
      left.append(badge, info);
      const actions = el("div", "flex shrink-0 gap-1");
      const edit = el("button", "rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200", "Sửa");
      edit.type = "button";
      edit.dataset.editCategory = item.id;
      edit.addEventListener("click", () => openCategoryModal(item.id));
      const remove = el("button", "rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100", "Xóa");
      remove.type = "button";
      remove.dataset.deleteCategory = item.id;
      remove.addEventListener("click", () => handleCategoryDelete(item.id, item.label));
      actions.append(edit, remove);
      card.append(left, actions);
      box.appendChild(card);
    }
  }

  function openCategoryModal(categoryId = null) {
    state.editingCategory = categoryId;
    const item = categoryId ? categoryList().find((entry) => entry.id === categoryId) : null;
    $("categoryModalTitle").textContent = item ? "Sửa nhóm thông tin" : "Thêm nhóm thông tin";
    $("categoryLabel").value = item ? item.label : "";
    $("categoryIcon").value = item ? item.icon : CATEGORY_ICONS[0];
    $("categoryColor").value = item ? item.color : "#0ea5e9";
    hideMessage($("categoryFormMessage"));
    renderIconPicker();
    updateCategoryPreview();
    show($("categoryModal"));
    $("categoryModal").classList.add("flex");
    $("categoryLabel").focus();
  }

  function closeCategoryModal() {
    hide($("categoryModal"));
    $("categoryModal").classList.remove("flex");
    state.editingCategory = null;
  }

  function updateCategoryPreview() {
    const preview = $("categoryPreview");
    if (!preview) return;
    const icon = $("categoryIcon").value.trim() || "📍";
    const label = $("categoryLabel").value.trim() || "Tên nhóm mới";
    preview.textContent = "Xem trước trên bộ lọc: " + icon + " " + label;
  }

  async function handleCategorySubmit(event) {
    event.preventDefault();
    const message = $("categoryFormMessage");
    hideMessage(message);
    const payload = {
      sessionId: state.sessionId,
      categoryId: state.editingCategory || undefined,
      label: $("categoryLabel").value,
      icon: $("categoryIcon").value.trim(),
      color: $("categoryColor").value,
    };
    if (!payload.label.trim()) {
      showMessage(message, "Vui lòng nhập tên nhóm thông tin.");
      return;
    }
    const button = $("categorySubmit");
    button.disabled = true;
    const result = await api(state.editingCategory ? "categories:update" : "categories:create", payload);
    button.disabled = false;
    if (!result.ok) {
      showMessage(message, firstError(result));
      return;
    }
    state.categories = result.categories;
    const wasEditing = Boolean(state.editingCategory);
    closeCategoryModal();
    rebuildCategoryUI();
    applyLocationFilters();
    toast(wasEditing ? "Đã cập nhật nhóm thông tin." : "Đã thêm nhóm thông tin mới.");
  }

  async function handleCategoryDelete(categoryId, label) {
    if (!window.confirm("Xóa nhóm \"" + label + "\"?\n\nChỉ xóa được khi chưa có phản hồi nào dùng nhóm này.")) return;
    const result = await api("categories:delete", { sessionId: state.sessionId, categoryId });
    if (!result.ok) {
      window.alert(firstError(result));
      return;
    }
    state.categories = result.categories;
    rebuildCategoryUI();
    applyLocationFilters();
    toast("Đã xóa nhóm " + label + ".");
  }

  function rebuildWardFilter() {
    // Danh sách phẳng mọi phường/xã, nhóm theo khu vực; giá trị đang chọn được giữ lại.
    const previous = $("wardFilter").value || "all";
    fillWardSelect($("wardFilter"), { allLabel: "Toàn tỉnh Khánh Hòa" });
    if (previous && $("wardFilter").options.some((option) => option.value === previous)) {
      $("wardFilter").value = previous;
    }
    state.filters.wardId = $("wardFilter").value || "all";
    state.filters.regionId = regionIdOfWard(state.filters.wardId) || "all";
  }

  function rebuildFeedbackWards() {
    const wardSelect = $("feedbackWard");
    if (isWard()) {
      // Cán bộ bị khóa địa bàn của mình: luôn chọn đúng phường/xã phụ trách.
      fillWardSelect(wardSelect, { selected: state.user.scope });
      wardSelect.value = state.user.scope;
      wardSelect.disabled = true;
    } else {
      fillWardSelect(wardSelect, { placeholder: "— Chọn Phường / Xã —" });
    }
    syncFeedbackRegion();
    rebuildFeedbackHamlets();
  }

  /** Ô Khu vực ẩn đi, nhưng vẫn cần giá trị để lưu kèm phản hồi (wardKey/regionId). */
  function syncFeedbackRegion() {
    const hidden = $("feedbackRegion");
    if (!hidden) return;
    const wardId = $("feedbackWard").value;
    clear(hidden);
    const option = el("option", "", wardId ? regionLabel(regionIdOfWard(wardId)) : "");
    option.value = wardId ? regionIdOfWard(wardId) : "";
    hidden.appendChild(option);
    hidden.value = option.value;
  }

  /** Danh sách thôn/tổ dân phố tự đổi theo phường/xã đã chọn. */
  function rebuildFeedbackHamlets() {
    const select = $("feedbackHamlet");
    if (!select) return;
    const wardId = $("feedbackWard").value;
    const hamlets = hamletsOf(wardId);
    clear(select);
    const placeholder = el("option", "", hamlets.length ? "— Chọn thôn / tổ dân phố —" : "— Chưa có thôn/tổ cho địa bàn này —");
    placeholder.value = "";
    select.appendChild(placeholder);
    for (const hamlet of hamlets) {
      const option = el("option", "", hamlet);
      option.value = hamlet;
      select.appendChild(option);
    }
    select.required = hamlets.length > 0;
  }

  function rebuildAccountWards() {
    const wardSelect = $("accountWard");
    const previous = wardSelect.value;
    fillWardSelect(wardSelect);
    if (previous && wardSelect.options.some((option) => option.value === previous)) wardSelect.value = previous;
    updateAccountWardMeta();
    // Tự phục hồi nếu danh mục chưa nạp xong lúc khởi động.
    if (!wardSelect.options.length) {
      ensureWardsLoaded().then(() => {
        fillWardSelect(wardSelect);
        updateAccountWardMeta();
      });
    }
  }

  /**
   * Bảo đảm danh mục phường/xã đã có trong bộ nhớ.
   * Trả Promise đã resolve khi `state.regions` có dữ liệu — dùng cho mọi
   * nơi mở form (tránh trường hợp bootstrap lỗi làm dropdown trống).
   */
  let wardsLoading = null;
  function ensureWardsLoaded() {
    if (state.regions && state.regions.length) return Promise.resolve(state.regions);
    if (wardsLoading) return wardsLoading;
    wardsLoading = (async () => {
      try {
        await loadRegions();
        buildRegionSelects();
      } catch (error) {
        console.error("[wards] không nạp được danh mục:", error);
      } finally {
        wardsLoading = null;
      }
      return state.regions;
    })();
    return wardsLoading;
  }

  /** Bộ lọc danh sách tài khoản: phẳng theo phường/xã (nhóm theo khu vực). */
  function rebuildAccountFilter() {
    const select = $("accountFilterRegion");
    if (!select) return;
    const previous = select.value || "all";
    select.nm = null;
    // Đổi nhãn "all" cho phù hợp (lọc theo phường/xã).
    fillWardSelect(select, { allLabel: "Tất cả phường/xã" });
    if (previous && select.options.some((option) => option.value === previous)) select.value = previous;
  }

  /** Bỏ dấu tiếng Việt -> "Phường Cam Linh" = "phuong cam linh". */
  function removeDiacritics(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase();
  }

  /**
   * Gợi ý tên đăng nhập theo địa bàn:
   *  Phường Cam Linh -> camlinh.cb | Xã Nam Cam Ranh -> namcamranh.cb
   *  Đặc khu Trường Sa -> truongsa.cb
   * Nếu trùng người đã tạo thì thêm số: camlinh2.cb, camlinh3.cb…
   */
  function suggestUsername(wardId) {
    const ward = wardLabel(wardId);
    const base = removeDiacritics(ward)
      .replace(/^(phuong|xa|thi tran|dac khu)\s+/i, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 24);
    if (!base) return "";
    const taken = new Set((state.accounts || []).map((account) => account.username));
    let candidate = base + ".cb";
    let index = 2;
    while (taken.has(candidate)) {
      candidate = base + index + ".cb";
      index += 1;
    }
    return candidate;
  }

  /** Gợi ý ngay trên form: địa bàn đã có cán bộ hay chưa. */
  function updateAccountWardMeta() {
    const wardId = $("accountWard").value;
    const regionId = regionIdOfWard(wardId);
    const holder = state.accounts.find((account) => account.scope === wardId);
    const hint = $("accountWardHint");
    hint.textContent = !wardId
      ? "Chọn Phường/Xã để tạo tài khoản cho đúng địa bàn."
      : holder
        ? "⚠️ Địa bàn này đã có cán bộ phụ trách (" + holder.displayName + ")."
        : "Tài khoản sẽ được gán cho " + wardLabel(wardId) + " (" + regionLabel(regionId) + ").";
    hint.className = "mt-1 text-[11px] " + (holder ? "text-amber-700" : "text-slate-500");

    const meta = $("accountWardMeta");
    if (!meta) return;
    clear(meta);
    if (!wardId) {
      hide(meta);
      return;
    }
    show(meta);
    meta.appendChild(el("p", "font-bold text-slate-700", wardLabel(wardId)));
    meta.appendChild(el("p", "mt-0.5",
      regionLabel(regionId) + " · " + (holder ? "đã có tài khoản" : "chưa có tài khoản") +
      " · tài khoản mới sẽ tự động được xếp vào địa bàn này."));

    // Tự điền tên đăng nhập gợi ý (chỉ khi admin chưa tự gõ hoặc đang giữ gợi ý cũ).
    const usernameInput = $("accountUsername");
    if (usernameInput) {
      const suggestion = suggestUsername(wardId);
      const current = usernameInput.value.trim();
      const untouched = !current || current === usernameInput.dataset.suggested;
      if (untouched && suggestion) {
        usernameInput.value = suggestion;
        usernameInput.dataset.suggested = suggestion;
      }
      usernameInput.placeholder = suggestion ? "vd: " + suggestion : "vd: camlinh.cb";
    }
  }

  /* ================================== Map ================================== */

  let map = null;

  function initMap() {
    if (map) return map;
    map = L.map("map", { zoomControl: false, attributionControl: false }).setView(PROVINCE_CENTER, PROVINCE_ZOOM);
    applyBasemap();
    L.control.zoom({ position: "topright" }).addTo(map);
    map.on("click", handleMapClick);
    state.mapReady = true;
    renderMapLegend();
    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener("resize", () => map.invalidateSize());
    return map;
  }

  /* Nền bản đồ: Google Maps (duy nhất). */
  const BASEMAP = Object.freeze({
    id: "google",
    label: "Google Maps",
    url: "https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}",
    maxZoom: 21,
    minZoom: 3,
  });

  function applyBasemap() {
    if (!map) return;
    if (state.baseLayer) map.removeLayer(state.baseLayer);
    state.baseLayer = L.tileLayer(BASEMAP.url, {
      maxZoom: BASEMAP.maxZoom,
      minZoom: BASEMAP.minZoom,
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      attributionControl: false,
      // Không gửi Referer đầy đủ (file://) — một số CDN tile từ chối request như vậy.
      referrerPolicy: "no-referrer",
      crossOrigin: true,
      detectRetina: false,
    }).addTo(map);

    // Theo dõi tải tile: có tile hiển thị thì ẩn cảnh báo;
    // lỗi toàn bộ thì hiện hướng dẫn thay vì khung xám trống.
    state.tileStats = { loaded: 0, errors: 0 };
    state.baseLayer.on("tileload", () => {
      state.tileStats.loaded += 1;
      if (state.tileStats.loaded > 0) hideTileWarning();
    });
    state.baseLayer.on("tileerror", () => {
      state.tileStats.errors += 1;
      if (state.tileStats.loaded === 0 && state.tileStats.errors >= 2) showTileWarning();
    });
    // Cảnh báo chỉ xuất hiện sau khi Leaflet đã thử tải (tránh nháy lúc khởi động).
    hideTileWarning();
    if (map.getZoom() > BASEMAP.maxZoom) map.setZoom(BASEMAP.maxZoom);
  }

  /** Khung cảnh báo trên bản đồ khi không tải được tile Google. */
  function showTileWarning() {
    const box = $("mapTileWarning");
    if (!box) return;
    clear(box);
    box.appendChild(el("p", "text-sm font-bold text-slate-800", "Không tải được ảnh nền Google Maps"));
    box.appendChild(el("p", "mt-1 text-xs leading-relaxed text-slate-600",
      "Máy có thể đang chặn tên miền mt0-3.google.com hoặc không có Internet. " +
      "Dữ liệu điểm hỗ trợ vẫn hoạt động bình thường."));
    const actions = el("div", "mt-3 flex flex-wrap justify-center gap-2");
    const retry = el("button", "rounded-xl bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800",
      "Thử lại");
    retry.type = "button";
    retry.addEventListener("click", () => {
      hideTileWarning();
      applyBasemap();
      refreshMapSize();
    });
    actions.appendChild(retry);
    box.appendChild(actions);
    show(box);
  }

  function hideTileWarning() {
    const box = $("mapTileWarning");
    if (box) hide(box);
  }

  /** Chú giải màu ghim theo nhóm thông tin (góc dưới trái bản đồ). */
  function renderMapLegend() {
    const legend = $("mapLegend");
    if (!legend) return;
    clear(legend);
    // Chỉ hiện các nhóm thực sự có điểm đã duyệt (kể cả nhóm admin vừa thêm).
    const used = new Set(state.locations.map((location) => location.category));
    for (const category of categoryList()) {
      if (used.size && !used.has(category.id)) continue;
      const item = el("span", "inline-flex items-center gap-1.5");
      const dot = el("span", "inline-block h-2.5 w-2.5 rounded-full");
      dot.style.background = category.color;
      item.append(dot, el("span", "text-slate-600", category.icon + " " + category.label));
      legend.appendChild(item);
    }
    if (!legend.children.length) hide(legend);
    else show(legend);
  }

  function clearMarkers() {
    if (!map) return;
    for (const marker of state.markers.values()) map.removeLayer(marker);
    state.markers.clear();
    if (state.tempMarker) {
      map.removeLayer(state.tempMarker);
      state.tempMarker = null;
    }
  }

  function markerFor(location) {
    const category = CATEGORIES[location.category] || CATEGORIES.ho_tro;
    const icon = L.divIcon({
      className: "",
      html: '<span class="custom-marker" style="background:' + category.color + '"><span>' + category.icon + "</span></span>",
      iconSize: [38, 44],
      iconAnchor: [19, 40],
      popupAnchor: [0, -38],
    });
    const marker = L.marker([location.lat, location.lng], { icon });
    marker.bindPopup(buildLocationPopup(location), { maxWidth: 260 });
    return marker;
  }

  /** Popup của Leaflet nhận HTML string -> chỉ ghép chuỗi từ dữ liệu đã escape. */
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function buildLocationPopup(location) {
    const category = CATEGORIES[location.category] || CATEGORIES.ho_tro;
    const destination = encodeURIComponent(location.lat + "," + location.lng);
    return [
      '<div class="max-w-[250px]">',
      '<p class="text-sm font-bold text-slate-900">' + escapeHtml(location.title) + "</p>",
      '<p class="mt-1 text-xs text-slate-600">' + escapeHtml(location.address) + "</p>",
      '<p class="mt-2 text-xs text-slate-600">' + escapeHtml(location.desc) + "</p>",
      '<p class="mt-2 text-xs"><a class="font-semibold text-teal-700" href="tel:' + encodeURIComponent(location.phone || "") + '">☎ ' + escapeHtml(location.phone || "") + "</a></p>",
      '<p class="mt-2"><span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">✓ ' + escapeHtml(category.label) + "</span></p>",
      '<a class="mt-3 inline-block rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white" href="https://www.google.com/maps/dir/?api=1&destination=' + destination + '" target="_blank" rel="noopener noreferrer">↗ Chỉ đường</a>',
      "</div>",
    ].join("");
  }

  function renderLocations(locations) {
    if (!map) initMap();
    for (const [id, marker] of state.markers) {
      map.removeLayer(marker);
      state.markers.delete(id);
    }
    for (const location of locations) {
      const marker = markerFor(location).addTo(map);
      if (location.images?.length) marker.on("click", () => toast("Địa điểm có hình ảnh xác minh trong chi tiết."));
      state.markers.set(location.id, marker);
    }

    const list = $("locationList");
    clear(list);
    if (!locations.length) {
      list.appendChild(el("p", "rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500", "Chưa có điểm nào được duyệt trong khu vực này."));
    }
    for (const location of locations) {
      list.appendChild(buildLocationCard(location));
    }
    $("resultCount").textContent = `${locations.length} địa điểm`;
  }

  function buildLocationCard(location) {
    const category = CATEGORIES[location.category] || CATEGORIES.ho_tro;
    const card = el("button", "location-card w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-teal-300 hover:bg-teal-50/50");
    card.type = "button";
    card.dataset.locationId = location.id;

    const head = el("span", "flex items-start gap-3");
    const badge = el("span", "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base", category.icon);
    badge.style.background = category.color + "18";
    const body = el("span", "min-w-0 flex-1");
    body.appendChild(el("span", "block text-sm font-bold leading-snug text-slate-800", location.title));
    body.appendChild(el("span", "mt-1 block text-xs leading-relaxed text-slate-500", location.address));
    const tag = el("span", "mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold", category.label);
    tag.style.background = category.color + "18";
    tag.style.color = category.color;
    body.appendChild(tag);
    head.append(badge, body);
    card.appendChild(head);

    card.addEventListener("click", () => focusLocation(location));
    return card;
  }

  function focusLocation(location) {
    map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
    state.markers.get(location.id)?.openPopup();
  }

  /** Toạ độ tâm dự phòng khi địa bàn chưa có điểm nào trên bản đồ. */
  const DISTRICT_CENTERS = {
    nha_trang: { lat: 12.2388, lng: 109.1967, zoom: 12 },
    cam_ranh: { lat: 11.9214, lng: 109.1599, zoom: 12 },
    ninh_hoa: { lat: 12.4916, lng: 109.1246, zoom: 12 },
    cam_lam: { lat: 12.0808, lng: 109.1632, zoom: 12 },
    truong_sa: { lat: 8.6447, lng: 111.9194, zoom: 9 },
  };

  /**
   * Khi người dùng chọn địa bàn ở bộ lọc, bản đồ tự di chuyển tới khu vực đó:
   *  - Có điểm đã duyệt trong vùng -> vừa khung (fitBounds) các điểm đó.
   *  - Chưa có điểm -> về tâm huyện (nếu chọn "Tất cả phường/xã") hoặc tâm tỉnh.
   */
  function flyToFilterArea() {
    if (!map || !state.mapReady) return;
    const { regionId, wardId } = state.filters;
    const inArea = state.locations.filter((location) => {
      const region = state.regions.find((item) => item.id === regionId);
      const regionOk =
        regionId === "all" ||
        (region ? region.wards.some((ward) => ward.id === location.ward) : true);
      return regionOk && (wardId === "all" || location.ward === wardId);
    });

    if (inArea.length === 1) {
      // Một điểm: bay tới đúng điểm và mở popup.
      focusLocation(inArea[0]);
      return;
    }
    if (inArea.length > 1) {
      const bounds = L.latLngBounds(inArea.map((item) => [item.lat, item.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      return;
    }
    // Không có điểm nào: dùng tâm địa bàn.
    if (regionId === "all") {
      map.flyTo(PROVINCE_CENTER, PROVINCE_ZOOM, { duration: 0.6 });
      return;
    }
    const center = (state.regions.find((item) => item.id === regionId) || {}).center || DISTRICT_CENTERS[regionId];
    if (center) map.flyTo([center.lat, center.lng], center.zoom || 12, { duration: 0.6 });
  }

  function matches(location) {
    const { regionId, wardId } = state.filters;
    const regionOk = regionId === "all" || (state.regions.find((region) => region.id === regionId)?.wards || [])
      .some((ward) => ward.id === location.ward);
    const wardOk = wardId !== "all" && location.ward === wardId;
    const categoryOk = state.activeCategory === "all" || location.category === state.activeCategory;
    return regionOk && wardOk && categoryOk;
  }

  async function loadLocations() {
    const result = await api("feedback:publicLocations");
    state.locations = result.ok ? result.locations : [];
    applyLocationFilters();
  }

  function applyLocationFilters() {
    // Chỉ có 1 dropdown: khu vực suy ra từ phường/xã đã chọn.
    state.filters.wardId = $("wardFilter").value || "all";
    state.filters.regionId = regionIdOfWard(state.filters.wardId) || "all";
    renderLocations(state.locations.filter(matches));
  }

  /** Các điểm đã duyệt trên bản đồ thuộc 1 phường/xã (dùng cho tab Xã/Phường, Tài khoản). */
  function locationsOfWard(wardId) {
    return state.locations.filter((location) => location.ward === wardId);
  }

  /**
   * Mở tab bản đồ, lọc đúng phường/xã và bay tới vị trí điểm đầu tiên.
   * Dùng cho shortcut "Xem điểm trên bản đồ" ở các tab khác.
   */
  async function showWardOnMap(wardId, locationId = null, coordinates = null) {
    state.filters.wardId = wardId;
    await openView("map");
    rebuildWardFilter();
    if ($("wardFilter").options.some((option) => option.value === wardId)) $("wardFilter").value = wardId;
    applyLocationFilters();
    const target = locationId
      ? state.locations.find((location) => location.id === locationId)
      : locationsOfWard(wardId)[0];
    if (target) {
      refreshMapSize();
      focusLocation(target);
    } else {
      toast("Địa bàn này chưa có điểm nào được công bố.");
    }
  }

  /** Nạp lại dữ liệu công khai rồi vẽ theo bộ lọc hiện tại. */
  async function refreshMap() {
    await loadLocations();
  }

  /* ================================ Feedback form ========================== */

  async function openFeedbackModal({ prefillWard = null } = {}) {
    if (!map) initMap();
    hideMessage($("feedbackFormMessage"));

    // Luôn bảo đảm danh mục đã nạp (tự nạp lại nếu lỗi lúc khởi động), rồi
    // ĐỔ LẠI danh sách mỗi lần mở modal — không phụ thuộc việc nạp lúc boot.
    await ensureWardsLoaded();
    rebuildFeedbackWards();

    if (prefillWard) {
      if (!isWard() && $("feedbackWard").options.some((option) => option.value === prefillWard)) {
        $("feedbackWard").value = prefillWard;
        syncFeedbackRegion();
        rebuildFeedbackHamlets();
      }
    }
    setHidden($("feedbackModal"), false);
    $("feedbackModal").classList.add("flex");
  }

  function closeFeedbackModal() {
    hide($("feedbackModal"));
    $("feedbackModal").classList.remove("flex");
    setPickingMode(false);
  }

  function setPickingMode(active) {
    state.pickingOnMap = active;
    $("gpsStatus").textContent = active ? "Chế độ chọn trên bản đồ: bấm vào bản đồ để đặt điểm." : "";
    if (active) {
      hide($("feedbackModal"));
      $("feedbackModal").classList.remove("flex");
    }
  }

  function setCoordinates(lat, lng, source) {
    $("feedbackLat").value = Number(lat).toFixed(6);
    $("feedbackLng").value = Number(lng).toFixed(6);
    $("gpsStatus").textContent = `Đã chọn: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} (${source})`;
  }

  function handleMapClick(event) {
    const { lat, lng } = event.latlng;
    if (state.pickingOnMap) {
      setCoordinates(lat, lng, "chọn trên bản đồ");
      setPickingMode(false);
      $("pickOnMapButton").textContent = "🗺️ Chọn trên bản đồ";
      openFeedbackModal();
      return;
    }
    if (!state.sessionId) return;
    setCoordinates(lat, lng, "bản đồ");
    if ($("feedbackModal").classList.contains("hidden")) openFeedbackModal();
  }

  function useGps() {
    const status = $("gpsStatus");
    if (!navigator.geolocation) {
      status.textContent = "Thiết bị không hỗ trợ GPS. Hãy chọn trực tiếp trên bản đồ.";
      return;
    }
    status.textContent = "Đang lấy vị trí GPS…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords.latitude, position.coords.longitude, "GPS");
        const center = [position.coords.latitude, position.coords.longitude];
        map.flyTo(center, 15, { duration: 0.6 });
      },
      (error) => {
        status.textContent = `Không lấy được GPS (${error?.message || "bị từ chối"}). Hãy chọn trên bản đồ.`;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  async function pickImages() {
    if (isDesktop()) {
      const result = await api("dialog:pickImages");
      if (!result.ok) {
        showMessage($("feedbackFormMessage"), firstError(result));
        return;
      }
      if (result.canceled) return;
      const room = MAX_IMAGES - state.pendingImages.length;
      const files = result.files.slice(0, Math.max(0, room)).map((file) => ({ name: file.name, path: file.path, savedId: null }));
      state.pendingImages.push(...files);
      renderPendingImages();
      return;
    }
    show($("imagePickerFallback"));
    $("imageFileInput").click();
  }

  function renderPendingImages() {
    const list = $("imageList");
    clear(list);
    state.pendingImages.forEach((file, index) => {
      const item = el("li", "relative rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600", file.name);
      const remove = el("button", "ml-2 font-bold text-red-600", "×");
      remove.type = "button";
      remove.title = "Bỏ ảnh này";
      remove.addEventListener("click", () => {
        state.pendingImages.splice(index, 1);
        renderPendingImages();
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  async function submitFeedback(event) {
    event?.preventDefault();
    const form = $("feedbackForm");
    const message = $("feedbackFormMessage");
    hideMessage(message);

    const payload = {
      fullName: form.elements.fullName.value,
      phone: form.elements.phone.value,
      email: form.elements.email.value,
      category: form.elements.category.value,
      districtId: $("feedbackRegion").value,
      wardId: form.elements.wardId.value,
      hamlet: $("feedbackHamlet") ? $("feedbackHamlet").value : "",
      address: form.elements.address.value,
      reason: form.elements.reason.value,
      lat: Number($("feedbackLat").value),
      lng: Number($("feedbackLng").value),
      images: state.pendingImages.map((file) => file.name),
    };

    if (!form.checkValidity()) {
      form.reportValidity();
      showMessage(message, "Vui lòng điền đủ các trường bắt buộc (*).");
      return;
    }
    // Tỉnh cố định (Khánh Hòa); bắt buộc chọn đúng Khu vực và Phường/Xã.
    if (!payload.districtId || payload.districtId === "all") {
      showMessage(message, "Vui lòng chọn Khu vực nơi xảy ra sự việc.");
      return;
    }
    if (!payload.wardId) {
      showMessage(message, "Vui lòng chọn Phường / Xã.");
      return;
    }

    const button = $("submitFeedback");
    button.disabled = true;

    // 1) Lưu ảnh vào thư mục tạm (main chuẩn hoá tên file, chặn dung lượng).
    const savedNames = [];
    let pendingImageDir = "";
    if (state.pendingImages.length) {
      for (const file of state.pendingImages) {
        if (!file.path) {
          button.disabled = false;
          showMessage(message, "Chỉ gửi được ảnh khi chạy ứng dụng desktop (npm start).");
          return;
        }
        const saved = await api("image:save", { sourcePath: file.path });
        if (!saved.ok) {
          button.disabled = false;
          showMessage(message, firstError(saved, `Không lưu được ảnh ${file.name}.`));
          return;
        }
        savedNames.push(saved.saved.name);
        pendingImageDir = saved.pendingId;
      }
      payload.images = savedNames;
      payload.pendingImageDir = pendingImageDir;
    }

    // 2) Gửi phản hồi; main xác thực lại toàn bộ dữ liệu và đưa vào hàng đợi.
    const result = await api("feedback:submit", payload);
    button.disabled = false;
    if (!result.ok) {
      showMessage(message, firstError(result, "Không gửi được phản hồi."));
      return;
    }

    showMessage(message, result.message || "Đã gửi phản hồi.", "success");
    toast("Đã gửi tới cán bộ phường/xã để xác minh.");
    form.reset();
    state.pendingImages = [];
    renderPendingImages();
    $("feedbackLat").value = "";
    $("feedbackLng").value = "";
    if (state.tempMarker && map) {
      map.removeLayer(state.tempMarker);
      state.tempMarker = null;
    }
    rebuildFeedbackWards();
    await loadQueueCounts();
    // Nếu đang mở workspace của cán bộ, làm mới hàng đợi để thấy ngay phản hồi vừa gửi.
    if (state.view === "feedback" && state.sessionId) await loadQueue();
  }

  /* ====================== Tab 2: Phản hồi (hàng đợi) ====================== */

  async function loadQueueCounts() {
    if (!state.sessionId) return;
    const result = await api("feedback:list", { sessionId: state.sessionId, status: "all" });
    if (!result.ok) return;
    state.feedback.counts = result.counts;
    for (const node of document.querySelectorAll("[data-count]")) {
      node.textContent = String(result.counts?.[node.dataset.count] ?? 0);
    }
    const tab = $("tab-feedback");
    if (tab) {
      const pending = result.counts?.pending || 0;
      tab.textContent = pending ? "📨 Phản hồi (" + pending + ")" : "📨 Phản hồi";
      tab.setAttribute("aria-label", pending ? "Phản hồi, " + pending + " mục chờ duyệt" : "Phản hồi");
    }
  }

  async function loadQueue() {
    if (!state.sessionId) return;
    const list = $("feedbackList");
    const result = await api("feedback:list", { sessionId: state.sessionId, status: state.feedback.status });
    clear(list);
    if (!result.ok) {
      list.appendChild(el("p", "p-3 text-xs text-red-700", firstError(result)));
      return;
    }
    state.feedback.list = result.feedbacks;
    state.feedback.counts = result.counts;

    // Mặc định là "Chờ duyệt"; nếu đã hết mục chờ duyệt thì hiện tất cả
    // để cán bộ vẫn thấy lịch sử thay vì màn hình trống.
    if (state.feedback.status === "pending" && !result.feedbacks.length && (result.counts?.all || 0) > 0) {
      state.feedback.status = "all";
      await loadQueue();
      return;
    }

    const scopeText = isAdmin() ? "Toàn tỉnh" : result.scopeName || "Địa bàn của bạn";
    $("queueTitle").textContent = isAdmin() ? "Tất cả phản hồi" : "Phản hồi chờ xác minh";
    $("queueScopeBadge").textContent = scopeText;
    $("queueSubtitle").textContent = isAdmin()
      ? "Cấp Tỉnh xem được toàn bộ phản hồi nhưng chỉ Cán bộ Xã/Phường được xác nhận/phê duyệt."
      : "Chỉ hiển thị phản hồi thuộc địa bàn phụ trách. Mở một mục để xem ảnh, GPS và thông tin người gửi.";
    for (const node of document.querySelectorAll("[data-count]")) {
      node.textContent = String(result.counts?.[node.dataset.count] ?? 0);
    }
    highlightStatusFilter();
    await loadQueueCounts();

    if (!result.feedbacks.length) {
      const empty = el("div", "rounded-xl border border-dashed border-slate-300 p-6 text-center");
      empty.appendChild(el("p", "text-2xl", state.feedback.status === "pending" ? "✅" : "📭"));
      empty.appendChild(el("p", "mt-2 text-xs font-bold text-slate-600",
        state.feedback.status === "pending" ? "Không còn phản hồi chờ duyệt" : "Không có phản hồi trong mục này"));
      empty.appendChild(el("p", "mt-1 text-[11px] text-slate-500", "Phản hồi mới của người dân sẽ xuất hiện tại đây."));
      list.appendChild(empty);
    }
    for (const item of result.feedbacks) list.appendChild(buildQueueCard(item));

    const selected = result.feedbacks.find((item) => item.id === state.feedback.selected) || null;
    renderFeedbackDetail(selected);
  }

  function highlightStatusFilter() {
    for (const button of document.querySelectorAll(".status-btn")) {
      const active = button.dataset.status === state.feedback.status;
      button.classList.toggle("bg-teal-700", active);
      button.classList.toggle("text-white", active);
      button.classList.toggle("border-teal-700", active);
      button.classList.toggle("bg-white", !active);
      button.classList.toggle("text-slate-700", !active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function buildQueueCard(item) {
    const card = el("button", "block w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-teal-300 hover:shadow-sm");
    card.type = "button";
    card.dataset.feedbackId = item.id;
    card.setAttribute("aria-label", "Phản hồi của " + item.fullName + " tại " + wardLabel(item.wardId));

    const head = el("div", "flex items-start justify-between gap-2");
    head.appendChild(el("p", "min-w-0 truncate text-sm font-bold text-slate-800", item.fullName));
    head.appendChild(statusPill(item.status));
    card.appendChild(head);
    card.appendChild(el("p", "mt-0.5 truncate text-[11px] text-slate-500", wardLabel(item.wardId) + " · " + formatTime(item.createdAt)));
    const reason = item.reason.length > 80 ? item.reason.slice(0, 80) + "…" : item.reason;
    card.appendChild(el("p", "mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600", reason));

    const foot = el("span", "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500");
    foot.appendChild(el("span", "rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold", CATEGORIES[item.category]?.label || item.category));
    foot.appendChild(el("span", "", "📍 có GPS"));
    foot.appendChild(el("span", "", item.images?.length ? "🖼️ " + item.images.length + " ảnh" : "🖼️ không ảnh"));
    card.appendChild(foot);

    // Dòng IP thiết bị gửi ngay trên thẻ danh sách (để phát hiện spam nhanh).
    const ipRow = el("span", "mt-1.5 flex items-center gap-1 text-[10px] text-slate-500");
    ipRow.appendChild(el("span", "", "🖥️ IP thiết bị gửi:"));
    const ip = item.clientIp || item.ip || "không rõ";
    const ipChip = el("span", "rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-slate-700", ip);
    ipChip.dataset.ipChip = "true";
    ipRow.appendChild(ipChip);
    if (Number(item.submissionsFromDevice) > 1) {
      ipRow.appendChild(el("span", "ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700",
        "⚠️ " + item.submissionsFromDevice + " lần gửi"));
    }
    card.appendChild(ipRow);

    if (state.feedback.selected === item.id) card.classList.add("border-teal-400", "bg-teal-50/40");
    card.addEventListener("click", () => {
      state.feedback.selected = item.id;
      for (const node of $("feedbackList").querySelectorAll("[data-feedback-id]")) {
        const active = node.dataset.feedbackId === item.id;
        node.classList.toggle("border-teal-400", active);
        node.classList.toggle("bg-teal-50/40", active);
      }
      renderFeedbackDetail(item);
      $("feedbackDetail").scrollTop = 0;
    });
    return card;
  }

  function statusPill(status) {
    const label = STATUS_LABELS[status] || status;
    const tone = status === "approved" ? "bg-emerald-50 text-emerald-800"
      : status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800";
    return el("span", "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold " + tone, label);
  }

  function infoRow(label, value, href, tone = "text-slate-800") {
    const row = el("div", "min-w-0");
    row.appendChild(el("dt", "text-[11px] font-bold uppercase tracking-wide text-slate-500", label));
    if (href) {
      const link = el("a", "mt-0.5 block break-words font-semibold text-teal-700 hover:underline", value);
      link.href = href;
      row.appendChild(link);
    } else {
      row.appendChild(el("dd", "mt-0.5 break-words " + tone, value || "—"));
    }
    return row;
  }

  function renderFeedbackDetail(item) {
    const panel = $("feedbackDetail");
    clear(panel);
    if (!item) {
      const empty = el("div", "rounded-2xl border border-dashed border-slate-300 p-8 text-center");
      empty.appendChild(el("p", "text-3xl", "📨"));
      empty.appendChild(el("p", "mt-2 text-sm font-bold text-slate-700", "Chọn một phản hồi để xem chi tiết"));
      empty.appendChild(el("p", "mt-1 text-xs text-slate-500", "Chi tiết gồm thông tin người gửi, hình ảnh, định vị GPS và nút “Xác nhận / Phê duyệt”."));
      panel.appendChild(empty);
      return;
    }

    // --- Tiêu đề ---
    const head = el("div", "flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4");
    const titleBox = el("div", "min-w-0");
    titleBox.appendChild(el("h3", "text-lg font-bold text-slate-900", item.fullName));
    titleBox.appendChild(el("p", "mt-1 text-xs text-slate-500",
      wardLabel(item.wardId) + " · " + regionLabel(item.regionId) + " · gửi lúc " + formatTime(item.createdAt)));
    const chips = el("div", "mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold");
    const category = CATEGORIES[item.category] || CATEGORIES.ho_tro;
    const categoryChip = el("span", "rounded-full px-2 py-0.5", category.icon + " " + category.label);
    categoryChip.style.background = category.color + "18";
    categoryChip.style.color = category.color;
    chips.appendChild(categoryChip);
    chips.appendChild(el("span", "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600", item.id));
    titleBox.appendChild(chips);
    head.append(titleBox, statusPill(item.status));
    panel.appendChild(head);

    // --- Người gửi ---
    const sender = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
    sender.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Thông tin người gửi"));
    const senderGrid = el("dl", "mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2");
    senderGrid.append(
      infoRow("Họ tên", item.fullName),
      infoRow("Số điện thoại", item.phone, "tel:" + encodeURIComponent(item.phone)),
      infoRow("Email", item.email, "mailto:" + encodeURIComponent(item.email)),
      infoRow("Phường/Xã", wardLabel(item.wardId)),
    );
    sender.appendChild(senderGrid);
    // Dòng IP/Thiết bị ngay dưới thông tin người gửi (để phát hiện spam/lạm dụng).
    sender.appendChild(buildClientIpLine(item));
    panel.appendChild(sender);

    // --- Nội dung / lý do ---
    const reasonBox = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
    reasonBox.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Lý do / Nội dung"));
    reasonBox.appendChild(el("p", "mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-800", item.reason));
    reasonBox.appendChild(el("p", "mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500", "Địa chỉ chi tiết"));
    reasonBox.appendChild(el("p", "mt-1 text-sm text-slate-800", item.address));
    panel.appendChild(reasonBox);

    // --- Hình ảnh ---
    const galleryBox = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
    galleryBox.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500",
      item.images?.length ? "Hình ảnh minh chứng (" + item.images.length + ")" : "Hình ảnh minh chứng"));
    if (item.images?.length) {
      const gallery = el("div", "mt-2 flex flex-wrap gap-2");
      for (const name of item.images) gallery.appendChild(buildImageThumb(item.id, name));
      galleryBox.appendChild(gallery);
    } else {
      galleryBox.appendChild(el("p", "mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500", "Người gửi không đính kèm hình ảnh."));
    }
    panel.appendChild(galleryBox);

    // --- Định vị GPS ---
    const gpsBox = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
    gpsBox.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Định vị GPS"));
    const gpsGrid = el("dl", "mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2");
    gpsGrid.append(
      infoRow("Toạ độ", item.lat.toFixed(6) + ", " + item.lng.toFixed(6)),
      infoRow("Định dạng khác", item.lat.toFixed(5) + ", " + item.lng.toFixed(5)),
    );
    gpsBox.appendChild(gpsGrid);
    const gpsActions = el("div", "mt-3 flex flex-wrap gap-2");
    const dir = el("a", "rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200", "↗ Chỉ đường");
    dir.href = "https://www.google.com/maps/dir/?api=1&destination=" + item.lat + "," + item.lng;
    dir.target = "_blank";
    dir.rel = "noopener noreferrer";
    const zoom = el("button", "rounded-xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100", "🗺️ Xem vị trí trên bản đồ");
    zoom.type = "button";
    zoom.addEventListener("click", async () => {
      // Giữ lại phản hồi đang xem để quay lại tab Phản hồi vẫn còn chi tiết.
      state.feedback.selected = item.id;
      await showWardOnMap(item.wardId, item.id);
    });
    gpsActions.append(dir, zoom);
    gpsBox.appendChild(gpsActions);
    panel.appendChild(gpsBox);

    // --- Nguồn gửi: IP + thiết bị (admin xem chi tiết) ---
    panel.appendChild(buildOriginBlock(item));

    // --- Lịch sử ---
    if (item.history?.length) {
      const history = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
      history.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Lịch sử xử lý"));
      const listEl = el("ul", "mt-2 space-y-1 text-[11px] text-slate-600");
      for (const entry of item.history) {
        listEl.appendChild(el("li", "", formatTime(entry.at) + " · " + entry.action + " · " + entry.by + (entry.note ? " · " + entry.note : "")));
      }
      history.appendChild(listEl);
      panel.appendChild(history);
    }

    // --- Kết luận / phê duyệt ---
    if (item.canReview && item.status === "pending") {
      panel.appendChild(buildReviewActions(item));
    } else if (isAdmin() && item.status === "pending") {
      const note = el("p", "mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900",
        "Chỉ Cán bộ Xã/Phường phụ trách địa bàn mới được xác nhận/phê duyệt phản hồi này.");
      panel.appendChild(note);
    } else if (item.status !== "pending") {
      const done = el("div", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
      done.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Kết quả xác minh"));
      done.appendChild(el("p", "mt-2 text-sm font-semibold " + (item.status === "approved" ? "text-emerald-700" : "text-red-700"),
        item.status === "approved" ? "✓ Đã xác nhận và công bố trên bản đồ." : "✕ Đã từ chối."));
      if (item.reviewNote) done.appendChild(el("p", "mt-1 text-xs text-slate-600", "Ghi chú: " + item.reviewNote));
      if (item.reviewedAt) done.appendChild(el("p", "mt-1 text-[11px] text-slate-500", "Xử lý lúc " + formatTime(item.reviewedAt)));
      panel.appendChild(done);
      // Đã duyệt: cán bộ gia hạn thêm ngày hoặc gắn vĩnh viễn.
      if (item.status === "approved") panel.appendChild(buildDisplayActions(item));
    }
  }

  /**
   * Dòng "🖥️ IP thiết bị gửi: <chip>" kèm thiết bị + cảnh báo gửi nhiều lần.
   * Dùng chung cho chi tiết phản hồi và khối nguồn gửi.
   */
  function buildClientIpLine(item) {
    const row = el("p", "mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600");
    row.appendChild(el("span", "font-semibold", "🖥️ IP thiết bị gửi:"));    const ip = item.clientIp || item.ip || "";
    if (ip) {
      const chip = el("span", "rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[11px] font-semibold text-slate-800", ip);
      chip.dataset.ipChip = "true";
      chip.setAttribute("title", "Địa chỉ IP của thiết bị đã gửi phản hồi");
      row.appendChild(chip);
    } else {
      row.appendChild(el("span", "italic text-slate-400", "chưa ghi nhận (hồ sơ cũ)"));
    }
    const device = item.deviceInfo || {};
    const agent = device.userAgent ? describeUserAgent(device.userAgent) : "";
    const host = item.hostname || device.hostname || "";
    if (agent || host) {
      row.appendChild(el("span", "text-slate-400", "· " + [agent, host].filter(Boolean).join(" · ")));
    }
    if (Number(item.submissionsFromDevice) > 1) {
      const flag = el("span", "rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700",
        "⚠️ thiết bị đã gửi " + item.submissionsFromDevice + " lần");
      flag.setAttribute("title", "Cùng một thiết bị/IP gửi nhiều phản hồi — cần kiểm tra spam");
      row.appendChild(flag);
    }
    return row;
  }

  /** Rút gọn User-Agent thành tên trình duyệt/hệ điều hành dễ đọc. */
  function describeUserAgent(ua) {
    const value = String(ua || "");
    const os = /Windows NT 10/.test(value) ? "Windows 10/11"
      : /Windows/.test(value) ? "Windows"
        : /Android/.test(value) ? "Android"
          : /iPhone|iPad/.test(value) ? "iOS"
            : /Mac OS X/.test(value) ? "macOS"
              : /Linux/.test(value) ? "Linux" : "Không rõ HĐH";
    const browser = /Edg\//.test(value) ? "Edge"
      : /Chrome\//.test(value) ? "Chrome"
        : /Electron/.test(value) ? "Electron"
          : /Firefox\//.test(value) ? "Firefox"
            : /Safari\//.test(value) ? "Safari" : "";
    return [os, browser].filter(Boolean).join(" · ");
  }

  function buildImageThumb(feedbackId, name) {
    const figure = el("figure", "w-28");
    const img = el("img", "h-24 w-28 rounded-lg border border-slate-200 object-cover");
    img.alt = "Ảnh đính kèm " + name;
    img.loading = "lazy";
    img.dataset.feedbackId = feedbackId;
    img.dataset.imageName = name;
    // Tên tệp đã chuẩn hoá (img-*.png) ở main process nên an toàn để ghép URL.
    img.src = isDesktop()
      ? `app-image://images/${encodeURIComponent(feedbackId)}/${encodeURIComponent(name)}`
      : "";
    img.addEventListener("error", () => {
      figure.classList.add("opacity-60");
      if (!figure.querySelector("[data-image-error]")) {
        figure.appendChild(el("figcaption", "text-[10px] text-red-600", "Không tải được ảnh"));
      }
    });
    figure.appendChild(img);
    figure.appendChild(el("figcaption", "mt-1 truncate text-[10px] text-slate-500", name));
    return figure;
  }

  function buildReviewActions(item) {
    const box = el("section", "mt-4 rounded-2xl border-2 border-teal-200 bg-teal-50/60 p-4");
    box.appendChild(el("h4", "text-sm font-bold text-teal-900", "Kết luận xác minh của cán bộ"));
    box.appendChild(el("p", "mt-1 text-[11px] text-teal-900/80", "Ghi chú xác minh là bắt buộc khi từ chối (tối thiểu 5 ký tự)."));

    const note = el("textarea", "scroll-thin mt-2 w-full rounded-xl border border-slate-200 p-2.5 text-sm");
    note.rows = 3;
    note.maxLength = 300;
    note.name = "reviewNote";
    note.placeholder = "Ví dụ: Đã đến kiểm tra, điểm phát cơm hoạt động đúng mô tả, ảnh khớp thực tế…";
    box.appendChild(note);

    // Thời hạn hiển thị trên bản đồ sau khi duyệt (mặc định 4 ngày).
    const displayRow = el("div", "mt-3 rounded-xl bg-white p-2.5 ring-1 ring-teal-100");
    const displayLabel = el("label", "block text-[11px] font-bold text-slate-600", "Thời gian hiển thị trên bản đồ");
    const displaySelect = el("select", "mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs");
    for (const option of [
      { value: "4", label: "4 ngày (mặc định)" },
      { value: "7", label: "7 ngày" },
      { value: "14", label: "14 ngày" },
      { value: "30", label: "30 ngày" },
      { value: "permanent", label: "Hiển thị vĩnh viễn" },
    ]) {
      const opt = el("option", "", option.label);
      opt.value = option.value;
      displaySelect.appendChild(opt);
    }
    displayRow.append(displayLabel, displaySelect);
    box.appendChild(displayRow);

    const message = el("p", "mt-2 hidden rounded-lg p-2 text-xs");
    const actions = el("div", "mt-3 flex flex-col gap-2 sm:flex-row");
    const approve = el("button", "flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60",
      "✓ Xác nhận / Phê duyệt");
    approve.type = "button";
    const reject = el("button", "flex-1 rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-60",
      "✕ Từ chối");
    reject.type = "button";
    actions.append(approve, reject);
    box.append(actions, message);

    const send = async (status) => {
      approve.disabled = true;
      reject.disabled = true;
      const result = await api("feedback:review", {
        sessionId: state.sessionId,
        feedbackId: item.id,
        status,
        note: note.value,
        displayDays: displaySelect.value === "permanent" ? null : Number(displaySelect.value),
        permanent: displaySelect.value === "permanent",
      });
      approve.disabled = false;
      reject.disabled = false;
      if (!result.ok) {
        message.textContent = firstError(result);
        message.className = "mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800";
        show(message);
        return;
      }
      toast(status === "approved"
        ? (displaySelect.value === "permanent" ? "Đã duyệt — hiển thị vĩnh viễn trên bản đồ." : "Đã duyệt — hiển thị " + displaySelect.value + " ngày.")
        : "Đã từ chối phản hồi.");
      state.feedback.selected = null;
      await Promise.all([loadQueue(), refreshMap(), loadNotifications()]);
    };
    approve.addEventListener("click", () => send("approved"));
    reject.addEventListener("click", () => send("rejected"));
    return box;
  }

  /** Sau khi duyệt: cán bộ gia hạn thêm ngày hoặc gắn vĩnh viễn. */
  function buildDisplayActions(item) {
    const box = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");
    box.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Thời gian hiển thị trên bản đồ"));
    const info = item.displayInfo || {};
    const status = info.permanent
      ? "Đang hiển thị vĩnh viễn"
      : info.active
        ? "Còn " + info.daysLeft + " ngày (đến " + formatTime(info.until) + ")"
        : "Đã hết hạn hiển thị";
    box.appendChild(el("p", "mt-1 text-sm font-semibold " + (info.active || info.permanent ? "text-emerald-700" : "text-red-700"), status));
    if (!item.canReview) return box;

    const controls = el("div", "mt-3 flex flex-wrap gap-2");
    for (const days of [4, 7, 30]) {
      const extend = el("button", "rounded-xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100", "+ " + days + " ngày");
      extend.type = "button";
      extend.dataset.extendDays = String(days);
      extend.addEventListener("click", async () => {
        extend.disabled = true;
        const result = await api("feedback:extendDisplay", { sessionId: state.sessionId, feedbackId: item.id, days });
        extend.disabled = false;
        if (!result.ok) return toast(firstError(result));
        toast("Đã gia hạn thêm " + days + " ngày.");
        state.feedback.selected = item.id;
        await Promise.all([loadQueue(), refreshMap()]);
      });
      controls.appendChild(extend);
    }
    if (!info.permanent) {
      const permanent = el("button", "rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700", "📌 Hiển thị vĩnh viễn");
      permanent.type = "button";
      permanent.dataset.makePermanent = "true";
      permanent.addEventListener("click", async () => {
        permanent.disabled = true;
        const result = await api("feedback:setPermanent", { sessionId: state.sessionId, feedbackId: item.id });
        permanent.disabled = false;
        if (!result.ok) return toast(firstError(result));
        toast("Đã gắn hiển thị vĩnh viễn.");
        state.feedback.selected = item.id;
        await Promise.all([loadQueue(), refreshMap()]);
      });
      controls.appendChild(permanent);
    }
    box.appendChild(controls);
    return box;
  }

  /* ===================== Tab 3: Xã/Phường (thống kê) ===================== */

  async function loadDirectory() {
    const result = await api("directory:statistics", { sessionId: state.sessionId });
    const grid = $("directoryGrid");
    clear(grid);
    if (!result.ok) {
      grid.appendChild(el("p", "text-sm text-red-700", firstError(result)));
      return;
    }
    state.directory = result.statistics;

    if (result.scope) {
      $("directorySubtitle").textContent = "Số liệu địa bàn " + (result.scopeName || "") + " mà bạn phụ trách.";
    } else {
      $("directorySubtitle").textContent =
        "Đơn vị hành chính cấp xã/phường tại Khánh Hòa, chia theo khu vực, kèm số tài khoản cán bộ và điểm hỗ trợ.";
    }

    const totals = result.statistics.reduce(
      (acc, region) => ({
        wards: acc.wards + region.wardCount,
        accounts: acc.accounts + region.accountCount,
        pending: acc.pending + region.pendingCount,
        approved: acc.approved + region.approvedCount,
      }),
      { wards: 0, accounts: 0, pending: 0, approved: 0 },
    );
    const totalsBox = $("directoryTotals");
    clear(totalsBox);
    totalsBox.append(
      statChip(totals.wards + " phường/xã", "bg-white text-slate-700 border border-slate-200"),
      statChip(totals.accounts + " tài khoản cán bộ", "bg-teal-700 text-white"),
      statChip(totals.approved + " điểm đã công bố", "bg-emerald-100 text-emerald-900"),
      statChip(totals.pending + " chờ duyệt", "bg-amber-100 text-amber-900"),
    );

    // Mỗi phường/xã là một thẻ (2 cấp: không còn nhóm theo huyện).
    const wards = result.statistics.flatMap((region) =>
      region.wards.map((ward) => ({ ...ward, regionId: region.id, regionName: region.name })),
    );
    state.directory = wards;
    for (const ward of wards) grid.appendChild(buildWardCard(ward));
    const selected = state.directory.find((ward) => ward.id === state.directory_selected);
    renderDirectoryDetail(selected || null);
  }

  function statChip(text, className) {
    return el("span", "rounded-full px-3 py-1 font-bold " + className, text);
  }

  /* --------------- CRUD phường/xã (chỉ Cấp Tỉnh) --------------- */

  /** Mở modal thêm mới hoặc sửa. `wardId` null = thêm mới. */
  function openWardModal({ districtId = null, wardId = null } = {}) {
    state.wardEditing = wardId;
    const units = state.units && state.units.length ? state.units : [];
    fillSelect($("wardDistrict"), units.map((unit) => ({ id: unit.districtId, name: unit.districtName })),
      { selected: districtId || (units[0] && units[0].districtId) });
    $("wardDistrict").disabled = Boolean(wardId);

    if (wardId) {
      const district = state.regions.find((item) => item.wards.some((ward) => ward.id === wardId));
      const ward = district && district.wards.find((item) => item.id === wardId);
      $("wardModalTitle").textContent = "Sửa phường/xã";
      if (ward) {
        $("wardNameInput").value = ward.name;
        $("wardOldUnits").value = ward.legacy || "";
        $("wardHamlets").value = (ward.hamlets || []).join("\n");
      }
    } else {
      $("wardModalTitle").textContent = "Thêm phường/xã";
      $("wardForm").reset();
      $("wardHamlets").value = "";
    }
    hideMessage($("wardFormMessage"));
    show($("wardModal"));
    $("wardModal").classList.add("flex");
    $("wardNameInput").focus();
  }

  function closeWardModal() {
    hide($("wardModal"));
    $("wardModal").classList.remove("flex");
    state.wardEditing = null;
  }

  async function handleWardSubmit(event) {
    event.preventDefault();
    const message = $("wardFormMessage");
    hideMessage(message);
    const hamlets = $("wardHamlets").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const payload = {
      sessionId: state.sessionId,
      districtId: $("wardDistrict").value,
      wardId: state.wardEditing || undefined,
      wardName: $("wardNameInput").value,
      oldUnits: $("wardOldUnits").value,
      hamlets,
    };
    if (!payload.wardName.trim() || !hamlets.length) {
      showMessage(message, "Vui lòng nhập tên và ít nhất một Thôn/Tổ dân phố.");
      return;
    }

    const button = $("wardSubmit");
    button.disabled = true;
    const channel = state.wardEditing ? "regions:update" : "regions:create";
    const result = await api(channel, payload);
    button.disabled = false;
    if (!result.ok) {
      showMessage(message, firstError(result));
      return;
    }
    closeWardModal();
    toast(state.wardEditing ? "Đã cập nhật phường/xã." : "Đã thêm phường/xã mới.");
    // Nạp lại danh mục -> mọi dropdown (bản đồ, phản hồi, tài khoản) tự cập nhật.
    await loadRegions();
    buildRegionSelects();
    await loadDirectory();
  }

  async function handleWardDelete(districtId, wardId, wardName) {
    const confirmed = window.confirm(
      "Xóa " + wardName + "?\n\nChỉ xóa được khi đơn vị không còn tài khoản cán bộ và phản hồi.",
    );
    if (!confirmed) return;
    const result = await api("regions:delete", { sessionId: state.sessionId, wardId });
    if (!result.ok) {
      window.alert(firstError(result));
      return;
    }
    toast("Đã xóa " + wardName + ".");
    await loadRegions();
    buildRegionSelects();
    await loadDirectory();
    void districtId;
  }

  /** Thẻ 1 phường/xã (kèm tên khu vực nhỏ để dễ định vị). */
  function buildWardCard(ward) {
    const card = el("button", "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-400 hover:shadow-md");
    card.type = "button";
    card.dataset.wardId = ward.id;
    card.setAttribute("aria-label", ward.name + ", " + ward.regionName);

    const head = el("div", "flex items-start justify-between gap-2");
    const titles = el("div", "min-w-0");
    titles.appendChild(el("p", "truncate text-sm font-bold text-slate-900", ward.name));
    titles.appendChild(el("p", "truncate text-[10px] text-slate-500", ward.regionName));
    head.appendChild(titles);
    head.appendChild(el("span", "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold " +
      (ward.pendingCount ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"),
      ward.pendingCount ? ward.pendingCount + " chờ duyệt" : "Đã duyệt hết"));
    card.appendChild(head);

    const stats = el("div", "mt-3 grid grid-cols-3 gap-2 text-center");
    const cell = (value, label, tone) => {
      const box = el("div", "rounded-xl px-1 py-2 " + tone);
      box.appendChild(el("p", "text-base font-bold leading-none", value));
      box.appendChild(el("p", "mt-1 text-[10px] font-semibold", label));
      return box;
    };
    stats.append(
      cell(ward.accountCount, "tài khoản", "bg-teal-50 text-teal-800"),
      cell(ward.approvedCount, "điểm hỗ trợ", "bg-emerald-50 text-emerald-800"),
      cell(ward.totalCount, "phản hồi", "bg-slate-50 text-slate-700"),
    );
    card.appendChild(stats);

    // Nút yêu cầu cán bộ rà soát/cập nhật danh sách điểm hỗ trợ của địa bàn.
    const requestUpdate = el("button", "mt-3 w-full rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-amber-600",
      "🔔 Yêu cầu cập nhật thông tin");
    requestUpdate.type = "button";
    requestUpdate.dataset.requestUpdate = ward.id;
    requestUpdate.addEventListener("click", (event) => {
      // Nằm trong thẻ -> không kích hoạt sự kiện chọn thẻ.
      event.stopPropagation();
      event.preventDefault();
      handleRequestUpdate(ward);
    });
    card.appendChild(requestUpdate);

    card.addEventListener("click", () => {
      state.directory_selected = ward.id;
      renderDirectoryDetail(ward);
      for (const node of $("directoryGrid").querySelectorAll("[data-ward-id]")) {
        const active = node.dataset.wardId === ward.id;
        node.classList.toggle("border-teal-500", active);
        node.classList.toggle("ring-1", active);
        node.classList.toggle("ring-teal-300", active);
      }
      const detail = $("directoryDetail");
      if (typeof detail?.scrollIntoView === "function") {
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    return card;
  }

  /** Chi tiết một phường/xã: số liệu, thôn/tổ dân phố, thao tác của Cấp Tỉnh. */
  function renderDirectoryDetail(ward) {
    const box = $("directoryDetail");
    clear(box);
    if (!ward) {
      hide(box);
      return;
    }
    show(box);

    const head = el("div", "flex flex-wrap items-start justify-between gap-3");
    const title = el("div", "min-w-0");
    title.appendChild(el("h3", "text-lg font-bold text-slate-900", ward.name));
    title.appendChild(el("p", "mt-1 text-xs text-slate-500",
      ward.regionName + " · Phường/Xã của tỉnh Khánh Hòa"));
    if (ward.legacy && ward.legacy !== ward.name) {
      title.appendChild(el("p", "mt-1 text-[11px] text-slate-500", "Trước sáp nhập: " + ward.legacy));
    }
    head.appendChild(title);

    if (isAdmin()) {
      const actions = el("div", "flex flex-wrap gap-2");
      const edit = el("button", "rounded-xl bg-white px-3 py-2 text-xs font-bold text-teal-800 ring-1 ring-teal-300 hover:bg-teal-50",
        "✎ Sửa phường/xã");
      edit.type = "button";
      edit.addEventListener("click", () => openWardModal({ districtId: ward.regionId, wardId: ward.id }));
      const create = el("button", "rounded-xl bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800",
        "＋ Tạo tài khoản cho địa bàn này");
      create.type = "button";
      create.addEventListener("click", () => {
        rebuildAccountWards();
        if (state.accounts) selectOption($("accountWard"), ward.id);
        updateAccountWardMeta();
        openView("accounts");
      });
      actions.append(edit, create);
      head.appendChild(actions);
    }
    box.appendChild(head);

    const stats = el("div", "mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4");
    const cell = (value, label, tone) => {
      const item = el("div", "rounded-xl px-3 py-2 " + tone);
      item.appendChild(el("p", "text-lg font-bold leading-none", value));
      item.appendChild(el("p", "mt-1 text-[10px] font-semibold", label));
      return item;
    };
    stats.append(
      cell(ward.accountCount, "tài khoản cán bộ", "bg-teal-50 text-teal-800"),
      cell(ward.approvedCount, "điểm đã công bố", "bg-emerald-50 text-emerald-800"),
      cell(ward.pendingCount, "chờ duyệt", "bg-amber-50 text-amber-800"),
      cell(ward.totalCount, "tổng phản hồi", "bg-slate-50 text-slate-700"),
    );
    box.appendChild(stats);

    const hamlets = ward.hamlets || [];
    box.appendChild(el("p", "mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-500",
      "Thôn / Tổ dân phố (" + hamlets.length + ")"));
    const chips = el("div", "mt-2 flex flex-wrap gap-1.5");
    if (!hamlets.length) {
      chips.appendChild(el("span", "text-xs text-slate-500", "Chưa khai báo thôn/tổ dân phố."));
    }
    for (const hamlet of hamlets) {
      chips.appendChild(el("span", "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700", hamlet));
    }
    box.appendChild(chips);

    const actionsRow = el("div", "mt-4 flex flex-wrap gap-2");
    if (ward.approvedCount > 0) {
      const viewOnMap = el("button", "rounded-xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100", "🗺️ Xem trên bản đồ");
      viewOnMap.type = "button";
      viewOnMap.addEventListener("click", () => showWardOnMap(ward.id));
      actionsRow.appendChild(viewOnMap);
    }
    if (isAdmin() && hamlets.length >= 0) {
      const remove = el("button", "rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100", "🗑 Xóa phường/xã");
      remove.type = "button";
      remove.addEventListener("click", () => handleWardDelete(ward.regionId, ward.id, ward.name));
      actionsRow.appendChild(remove);
    }
    box.appendChild(actionsRow);
  }

  /* ======================= Tab 4: Tài khoản (admin) ======================= */

  async function loadAccounts() {
    const result = await api("accounts:list", { sessionId: state.sessionId });
    if (!result.ok) {
      showMessage($("accountFormMessage"), firstError(result));
      return;
    }
    state.accounts = result.accounts;
    $("accountCount").textContent = state.accounts.length + " tài khoản";
    renderAccountList();
    rebuildAccountWards();
  }

  function renderAccountList() {
    const list = $("accountList");
    clear(list);
    const filter = $("accountFilterRegion").value;
    const query = normalizeForSearch($("accountSearch") ? $("accountSearch").value : "");
    const visible = state.accounts.filter((account) => {
      const inRegion = filter === "all" || account.scope === filter;
      const q = normalizeForSearch(account.displayName + " " + account.username + " " + (account.scopeName || ""));
      return inRegion && (!query || q.includes(query));
    });

    $("accountCount").textContent = state.accounts.length + " tài khoản";
    renderAccountResultSummary(filter, visible);
    if (!visible.length) {
      list.appendChild(el("p", "rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500",
        state.accounts.length ? "Không có tài khoản khớp bộ lọc." : "Chưa có tài khoản cán bộ nào. Hãy tạo tài khoản đầu tiên ở biểu mẫu bên trái."));
      return;
    }

    // Nhóm theo thành phố/huyện để thấy rõ việc "tự động phân loại" của hệ thống.
    const groups = new Map();
    for (const account of visible) {
      const key = account.regionName || "Khác";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
    for (const [regionName, accounts] of groups) {
      const section = el("section", "rounded-xl border border-slate-200");
      const header = el("div", "flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2");
      header.appendChild(el("p", "text-xs font-bold text-slate-700", regionName));
      header.appendChild(el("span", "text-[11px] text-slate-500", accounts.length + " tài khoản"));
      section.appendChild(header);
      const body = el("div", "divide-y divide-slate-100");
      for (const account of accounts) body.appendChild(buildAccountRow(account));
      section.appendChild(body);
      list.appendChild(section);
    }
  }

  function normalizeForSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .trim();
  }

  /**
   * Tóm tắt ở cột phải khi đang lọc theo một phường/xã:
   * số tài khoản đang thấy và số điểm đã công bố, kèm lối tắt sang tab Xã/Phường.
   */
  function renderAccountResultSummary(wardId, visibleAccounts) {
    const box = $("accountResult");
    if (!box) return;
    clear(box);
    const regionId = regionIdOfWard(wardId);
    if (!wardId || wardId === "all" || !regionId) {
      hide(box);
      return;
    }
    show(box);

    const approved = locationsOfWard(wardId).length;
    box.appendChild(el("p", "text-xs font-bold text-teal-900", wardLabel(wardId)));
    box.appendChild(el("p", "mt-0.5 text-[11px] text-teal-900/80",
      regionLabel(regionId) + " · " + visibleAccounts.length + " tài khoản cán bộ · " + approved + " điểm đã công bố"));

    const actions = el("div", "mt-2 flex flex-wrap gap-2");
    const toDirectory = el("button", "rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50",
      "Xem chi tiết phường/xã này");
    toDirectory.type = "button";
    toDirectory.addEventListener("click", async () => {
      state.directory_selected = wardId;
      await openView("directory");
    });
    actions.appendChild(toDirectory);
    box.appendChild(actions);
  }

  function buildAccountRow(account) {
    const row = el("div", "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5");
    const info = el("div", "min-w-0");
    info.appendChild(el("p", "truncate text-sm font-semibold text-slate-800", account.displayName));
    info.appendChild(el("p", "text-[11px] text-slate-500",
      account.username + " · " + (account.scopeName || "—") + " · tạo " + formatTime(account.createdAt)));
    row.appendChild(info);

    const right = el("div", "flex items-center gap-2");
    right.appendChild(el(
      "span",
      "rounded-full px-2 py-0.5 text-[10px] font-bold " + (account.active ? "bg-emerald-50 text-emerald-800" : "bg-slate-200 text-slate-600"),
      account.active ? "Đang hoạt động" : "Đã khóa",
    ));
    const toggle = el("button", "rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60",
      account.active ? "Khóa" : "Mở khóa");
    toggle.type = "button";
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      const result = await api("accounts:setActive", { sessionId: state.sessionId, accountId: account.id, active: !account.active });
      toggle.disabled = false;
      if (!result.ok) {
        toast(firstError(result));
        return;
      }
      state.accounts = result.accounts;
      renderAccountList();
      rebuildAccountWards();
      toast(account.active ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
    });
    right.appendChild(toggle);

    // Sửa thông tin (họ tên / địa bàn)
    const edit = el("button", "rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11px] font-bold text-teal-800 hover:bg-teal-100", "Sửa");
    edit.type = "button";
    edit.dataset.editAccount = account.id;
    edit.addEventListener("click", () => openEditAccount(account));
    right.appendChild(edit);

    // Đặt lại mật khẩu
    const reset = el("button", "rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100", "Đổi mật khẩu");
    reset.type = "button";
    reset.dataset.resetAccount = account.id;
    reset.addEventListener("click", () => openResetPassword(account));
    right.appendChild(reset);

    row.appendChild(right);
    return row;
  }

  /* --------------------- Sửa tài khoản / Đặt lại mật khẩu -------------------- */

  let editingAccount = null;
  let resettingAccount = null;

  function openEditAccount(account) {
    editingAccount = account;
    $("editAccountMeta").textContent = account.username + " · tạo " + formatTime(account.createdAt);
    $("editAccountName").value = account.displayName;
    fillWardSelect($("editAccountWard"), { selected: account.scope || "" });
    hideMessage($("editAccountMessage"));
    show($("editAccountModal"));
    $("editAccountModal").classList.add("flex");
  }

  function closeEditAccount() {
    hide($("editAccountModal"));
    $("editAccountModal").classList.remove("flex");
    editingAccount = null;
  }

  async function handleEditAccountSubmit(event) {
    event.preventDefault();
    if (!editingAccount) return;
    const message = $("editAccountMessage");
    hideMessage(message);
    const button = $("editAccountSubmit");
    button.disabled = true;
    const result = await api("accounts:update", {
      sessionId: state.sessionId,
      accountId: editingAccount.id,
      displayName: $("editAccountName").value.trim(),
      wardId: $("editAccountWard").value,
    });
    button.disabled = false;
    if (!result.ok) {
      showMessage(message, firstError(result));
      return;
    }
    state.accounts = result.accounts;
    closeEditAccount();
    renderAccountList();
    rebuildAccountWards();
    toast(result.message);
  }

  function openResetPassword(account) {
    resettingAccount = account;
    $("resetPasswordUsername").textContent = account.username;
    $("resetPasswordName").textContent = account.displayName + (account.scopeName ? " · " + account.scopeName : "");
    $("resetPasswordInput").value = "";
    $("resetMustChange").checked = true;
    hideMessage($("resetPasswordMessage"));
    show($("resetPasswordModal"));
    $("resetPasswordModal").classList.add("flex");
    $("resetPasswordInput").focus();
  }

  function closeResetPassword() {
    hide($("resetPasswordModal"));
    $("resetPasswordModal").classList.remove("flex");
    resettingAccount = null;
  }

  async function handleResetPasswordSubmit(event) {
    event.preventDefault();
    if (!resettingAccount) return;
    const message = $("resetPasswordMessage");
    hideMessage(message);
    const newPassword = $("resetPasswordInput").value;
    if (newPassword.length < 8) {
      showMessage(message, "Mật khẩu mới phải có ít nhất 8 ký tự.");
      return;
    }
    const button = $("resetPasswordSubmit");
    button.disabled = true;
    const result = await api("accounts:resetPassword", {
      sessionId: state.sessionId,
      accountId: resettingAccount.id,
      newPassword,
      mustChangePassword: $("resetMustChange").checked,
    });
    button.disabled = false;
    if (!result.ok) {
      showMessage(message, firstError(result));
      return;
    }
    showMessage(message, result.message, "success");
    toast("Đã đặt lại mật khẩu. Hãy gửi mật khẩu mới cho cán bộ.");
    state.accounts = state.accounts.map((item) => (item.id === resettingAccount.id ? result.account : item));
    $("resetPasswordInput").value = "";
    renderAccountList();
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    const message = $("accountFormMessage");
    const form = $("createAccountForm");
    hideMessage(message);

    const payload = {
      sessionId: state.sessionId,
      displayName: $("accountName").value.trim(),
      username: $("accountUsername").value.trim(),
      password: $("accountPassword").value,
      wardId: $("accountWard").value,
      mustChangePassword: $("accountMustChange").checked,
    };

    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    const result = await api("accounts:create", payload);
    button.disabled = false;

    if (!result.ok) {
      showMessage(message, (result.errors || []).join(" "));
      return;
    }
    showMessage(
      message,
      "Đã tạo tài khoản cho " + result.account.displayName + " · " + result.account.scopeName + ". " +
      "Tài khoản đã được tự động phân quyền và xếp vào nhóm " + (result.account.regionName || "") + ".",
      "success",
    );
    state.accounts = result.accounts;
    form.reset();
    $("accountMustChange").checked = true;
    // Giữ nguyên địa bàn đang chọn để tạo tiếp cán bộ cho cùng thành phố/huyện.
    selectRegion($("accountRegion"), payload.wardId);
    rebuildAccountWards();
    renderAccountList();
  }

  /** Chọn đúng thành phố/huyện chứa phường/xã vừa dùng, sau khi form bị reset. */
  function selectRegion(select, wardId) {
    if (!wardId) return;
    for (const region of state.regions) {
      if (region.wards.some((ward) => ward.id === wardId)) {
        select.value = region.id;
        return;
      }
    }
  }

  /* ================================ Profile ================================ */

  /** Khách xem bản đồ công khai: có "user" hiển thị nhưng KHÔNG có phiên đăng nhập thật. */
  const isGuest = () => !state.sessionId;

  function openProfile() {
    const user = state.user;
    if (!user) return;

    if (isGuest()) {
      // Không có tài khoản -> chỉ thông báo, không cho sửa tên/mật khẩu.
      $("profileTitle").textContent = "Chế độ khách";
      $("profileMeta").textContent = "Chỉ xem bản đồ công khai — không cần đăng nhập.";
      show($("profileGuestNotice"));
      hide($("profileFields"));
      $("profileSubmit").disabled = true;
      hideMessage($("profileMessage"));
    } else {
      $("profileTitle").textContent = "Tài khoản của tôi";
      $("profileMeta").textContent = user.username + " · " + (user.role === "admin" ? "Cấp Tỉnh" : "Cán bộ " + user.scopeName);
      hide($("profileGuestNotice"));
      show($("profileFields"));
      $("profileSubmit").disabled = false;
      $("profileName").value = user.displayName;
      $("oldPassword").value = "";
      $("newPassword").value = "";
      hideMessage($("profileMessage"));
    }
    show($("profileModal"));
    $("profileModal").classList.add("flex");
  }

  function closeProfile() {
    hide($("profileModal"));
    $("profileModal").classList.remove("flex");
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const message = $("profileMessage");

    // Chặn ở tầng xử lý: khách không có phiên, không thể đổi thông tin/mật khẩu.
    if (isGuest()) {
      showMessage(message, "Chế độ khách không có tài khoản nên không thể đổi mật khẩu. Vui lòng đăng nhập để quản lý tài khoản.");
      return;
    }

    const nameResult = await api("profile:update", { sessionId: state.sessionId, displayName: $("profileName").value });
    if (!nameResult.ok) {
      showMessage(message, firstError(nameResult));
      return;
    }
    state.user = nameResult.user;
    $("currentUserName").textContent = state.user.displayName;
    $("profileMeta").textContent = state.user.username + " · " + (state.user.role === "admin" ? "Cấp Tỉnh" : "Cán bộ " + state.user.scopeName);

    const oldPassword = $("oldPassword").value;
    const newPassword = $("newPassword").value;
    if (oldPassword || newPassword) {
      const passResult = await api("auth:changePassword", { sessionId: state.sessionId, oldPassword, newPassword });
      if (!passResult.ok) {
        showMessage(message, firstError(passResult));
        return;
      }
      $("oldPassword").value = "";
      $("newPassword").value = "";
    }
    showMessage(message, "Đã cập nhật tài khoản.", "success");
    toast("Đã lưu thay đổi.");
  }

  /* ============================= Thông báo ============================== */

  let notificationTimer = 0;

  /** Nạp thông báo + cập nhật số trên chuông (gọi định kỳ). */
  async function loadNotifications() {
    if (!state.sessionId) return;
    const result = await api("notifications:list", { sessionId: state.sessionId });
    if (!result.ok) return;
    const previousEmergency = state.notifications.filter((item) => item.type === "emergency" && !item.read).length;
    state.notifications = result.notifications;
    state.unread = result.unread;
    state.emergencyUnread = result.emergencyUnread;
    renderBell();
    renderNotificationList();
    // Có cảnh báo khẩn cấp MỚI -> bật banner + âm thanh cảnh báo.
    if (result.emergencyUnread > previousEmergency) notifyEmergency();
  }

  function renderBell() {
    const badge = $("bellBadge");
    if (!badge) return;
    const unread = state.unread || 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    setHidden(badge, unread === 0);
    badge.className = "absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] text-white " +
      (state.emergencyUnread > 0 ? "bg-red-600 animate-pulse" : "bg-slate-600");
    if (state.emergencyUnread > 0) badge.classList.remove("hidden");
    const button = $("bellButton");
    if (button) {
      button.setAttribute("aria-label", unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo");
      button.classList.toggle("ring-2", state.emergencyUnread > 0);
      button.classList.toggle("ring-red-400", state.emergencyUnread > 0);
    }
    const box = $("notifyReviewersBox");
    if (box) setHidden(box, !isAdmin());
  }

  function renderNotificationList() {
    const list = $("notificationList");
    if (!list) return;
    clear(list);
    if (!state.notifications.length) {
      list.appendChild(el("p", "p-4 text-center text-xs text-slate-500", "Chưa có thông báo nào."));
      return;
    }
    for (const item of state.notifications) {
      const isEmergency = item.type === "emergency";
      const row = el("button", "block w-full rounded-xl border p-2.5 text-left transition hover:bg-slate-50 " +
        (isEmergency ? "border-red-200 bg-red-50/70" : item.read ? "border-slate-200 bg-white" : "border-teal-200 bg-teal-50/50"));
      row.type = "button";
      row.dataset.notificationId = item.id;
      const head = el("div", "flex items-start justify-between gap-2");
      head.appendChild(el("p", "text-xs font-bold " + (isEmergency ? "text-red-700" : "text-slate-800"),
        (isEmergency ? "🚨 " : item.type === "review_reminder" ? "📣 " : "📨 ") + item.title));
      if (!item.read) head.appendChild(el("span", "rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white", "Mới"));
      row.appendChild(head);
      row.appendChild(el("p", "mt-1 text-[11px] leading-relaxed text-slate-600", item.message));
      row.appendChild(el("p", "mt-1 text-[10px] text-slate-400", formatTime(item.createdAt)));
      row.addEventListener("click", () => openNotification(item));
      list.appendChild(row);
    }
  }

  async function openNotification(item) {
    await api("notifications:read", { sessionId: state.sessionId, notificationId: item.id });
    hide($("notificationPanel"));
    $("bellButton").setAttribute("aria-expanded", "false");
    if (item.feedbackId) {
      state.feedback.selected = item.feedbackId;
      state.feedback.status = "all";
      await openView("feedback");
    } else if (item.type === "update_request" && item.wardId) {
      // Yêu cầu cập nhật: đưa cán bộ thẳng tới tab Xã/Phường của địa bàn mình.
      state.directory_selected = item.wardId;
      await openView("directory");
    }
    await loadNotifications();
  }

  /** Cảnh báo khẩn cấp ngay trên màn hình (banner + chuông + rung). */
  function notifyEmergency() {
    toast("🚨 Trường hợp khẩn cấp: có phản hồi mới cần xử lý ngay!");
    const banner = $("emergencyBanner");
    if (!banner) return;
    const latest = state.notifications.find((item) => item.type === "emergency" && !item.read);
    clear(banner);
    if (!latest) {
      hide(banner);
      return;
    }
    const text = el("div", "min-w-0 flex-1");
    text.appendChild(el("p", "text-sm font-bold", "🚨 Trường hợp khẩn cấp"));
    text.appendChild(el("p", "mt-0.5 truncate text-xs", latest.message));
    const open = el("button", "shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50", "Xem ngay");
    open.type = "button";
    open.addEventListener("click", () => openNotification(latest));
    const close = el("button", "shrink-0 rounded-lg px-2 py-1 text-white/80 hover:text-white", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Ẩn cảnh báo");
    close.addEventListener("click", () => hide(banner));
    banner.append(el("span", "text-xl", "🚨"), text, open, close);
    show(banner);
    // Rung + âm báo ngắn (an toàn nếu thiết bị không hỗ trợ).
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      /* trình duyệt/thiết bị có thể chặn audio — không ảnh hưởng chức năng */
    }
  }

  function toggleNotificationPanel(force) {
    const panel = $("notificationPanel");
    if (!panel) return;
    const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
    setHidden(panel, !open);
    $("bellButton").setAttribute("aria-expanded", String(open));
    if (open) renderNotificationList();
  }

  /** Admin bấm "Nhắc cán bộ duyệt phản hồi". */
  async function handleRemindReviewers() {
    const button = $("notifyReviewersButton");
    button.disabled = true;
    const result = await api("notifications:remindReviewers", { sessionId: state.sessionId });
    button.disabled = false;
    if (!result.ok) return toast(firstError(result));
    toast(result.message);
    await loadNotifications();
  }

  /** Bật đồng bộ định kỳ để nhận cảnh báo khẩn cấp khi đang mở app. */
  function startNotificationPolling() {
    if (notificationTimer) return;
    // Một số môi trường (test/SSR) không có setInterval -> bỏ qua an toàn.
    if (typeof setInterval !== "function") return;
    notificationTimer = setInterval(() => {
      if (state.sessionId && !document.hidden) loadNotifications();
    }, 15000);
  }

  /* =========================== Khách & thiết bị =========================== */

  /** Mở danh sách phản hồi do CHÍNH thiết bị này đã gửi. */
  async function openMyFeedback() {
    const modal = $("myFeedbackModal");
    show(modal);
    modal.classList.add("flex");
    const list = $("myFeedbackList");
    const summary = $("myFeedbackSummary");
    clear(list);
    summary.textContent = "Đang tải…";

    const result = await api("device:myFeedbacks", {});
    if (!result.ok) {
      summary.textContent = firstError(result, "Không tải được dữ liệu thiết bị.");
      return;
    }
    if (!result.count) {
      summary.textContent = "Thiết bị này chưa gửi phản hồi nào.";
      return;
    }
    summary.textContent = `Thiết bị này đã gửi ${result.count} phản hồi` +
      (result.device && result.device.ipMasked ? ` · IP ${result.device.ipMasked}` : "");

    for (const item of result.feedbacks) {
      const card = el("div", "rounded-xl border border-slate-200 p-3");
      const head = el("div", "flex items-start justify-between gap-2");
      head.appendChild(el("p", "text-sm font-bold text-slate-800", item.categoryLabel));
      head.appendChild(statusPill(item.status));
      card.appendChild(head);
      card.appendChild(el("p", "mt-1 text-[11px] text-slate-500",
        `${item.wardName}${item.hamlet ? " · " + item.hamlet : ""} · ${formatTime(item.createdAt)}`));
      card.appendChild(el("p", "mt-1 text-xs leading-relaxed text-slate-600", item.address));
      if (item.reviewNote) {
        card.appendChild(el("p", "mt-1 text-[11px] text-amber-800", "Ghi chú cán bộ: " + item.reviewNote));
      }
      list.appendChild(card);
    }
  }

  /** Gửi thông báo yêu cầu cán bộ rà soát/cập nhật điểm hỗ trợ của địa bàn. */
  async function handleRequestUpdate(ward) {
    const result = await api("notifications:requestUpdate", { sessionId: state.sessionId, wardId: ward.id });
    if (!result.ok) {
      toast(firstError(result));
      return;
    }
    toast(result.message);
    // Admin thấy ngay trong chuông; cán bộ sẽ nhận ở lần đồng bộ tiếp theo.
    if (state.sessionId) await loadNotifications();
  }

  function closeMyFeedback() {
    hide($("myFeedbackModal"));
    $("myFeedbackModal").classList.remove("flex");
  }

  /** Khối IP + thiết bị (dành cho cán bộ/admin xem nguồn gửi). */
  function buildOriginBlock(item) {
    const box = el("section", "mt-4 rounded-2xl border border-slate-200 bg-white p-4");

    // Vẽ khung ngay (không chờ API) -> nút luôn tồn tại dù dữ liệu về chậm.
    const renderDetails = (origin) => {
      clear(box);
      box.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Nguồn gửi (IP & thiết bị)"));
      const o = origin || {};
      const rows = el("dl", "mt-2 space-y-1 text-xs");
      const row = (label, value) => {
        const line = el("div", "flex justify-between gap-3");
        line.appendChild(el("dt", "shrink-0 text-slate-500", label));
        line.appendChild(el("dd", "break-all text-right font-semibold text-slate-800", value || "—"));
        rows.appendChild(line);
      };
      row("IP", o.ip || "không rõ");
      row("Vị trí (ước lượng)", o.ipLocation ? o.ipLocation.area : "—");
      row("Thiết bị", o.deviceLabel || o.deviceId || "không rõ");
      row("Số lần gửi từ thiết bị", String(o.submissionsFromDevice || 0));
      row("Nguồn", o.submittedFrom === "desktop" ? "Ứng dụng desktop" : "Trình duyệt");
      if (o.deviceInfo) {
        row("Hệ điều hành", o.deviceInfo.os || o.deviceInfo.platform || "—");
        row("Tên máy", o.deviceInfo.hostname || "—");
        row("Ứng dụng/Trình duyệt", o.deviceInfo.app || describeUserAgent(o.deviceInfo.userAgent));
        if (o.deviceInfo.userAgent) {
          rows.appendChild(el("p", "mt-1 break-all text-[10px] text-slate-400", "UA: " + o.deviceInfo.userAgent));
        }
      }
      box.appendChild(rows);
      if (o.ipLocation && o.ipLocation.note) {
        box.appendChild(el("p", "mt-1 text-[10px] text-slate-400", o.ipLocation.note));
      }
    };

    if (isAdmin()) {
      box.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Nguồn gửi (IP & thiết bị)"));
      const view = el("button", "mt-2 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100",
        "🔎 Xem IP & thiết bị người gửi");
      view.type = "button";
      view.dataset.originFeedbackId = item.id;
      view.addEventListener("click", async () => {
        view.disabled = true;
        view.textContent = "Đang tải…";
        const result = await api("feedback:origin", { sessionId: state.sessionId, feedbackId: item.id });
        if (!result.ok) {
          view.disabled = false;
          view.textContent = "🔎 Xem IP & thiết bị người gửi";
          toast(firstError(result));
          return;
        }
        renderDetails(result.origin);
      });
      box.appendChild(view);
      return box;
    }

    // Cán bộ: chỉ thấy vị trí gửi, không xem IP thô.
    box.appendChild(el("h4", "text-xs font-bold uppercase tracking-wide text-slate-500", "Nguồn gửi (IP & thiết bị)"));
    const hint = el("p", "mt-2 text-xs text-slate-600", "Đang tải…");
    box.appendChild(hint);
    api("feedback:origin", { sessionId: state.sessionId, feedbackId: item.id }).then((result) => {
      if (!result.ok) {
        hint.textContent = firstError(result);
        return;
      }
      const o = result.origin || {};
      hint.textContent =
        "Gửi từ: " + (o.ipLocation ? o.ipLocation.area : "không xác định") +
        (o.submissionsFromDevice ? " · thiết bị đã gửi " + o.submissionsFromDevice + " lần" : "");
    });
    return box;
  }

  /* ================================ Web mode =============================== */

  /**
   * Chế độ trình duyệt (không có Electron): chỉ dùng để xem giao diện.
   * Không có đăng nhập/quản trị vì không có main process.
   */
  async function startWebMode() {
    state.regions = FALLBACK_REGIONS;
    state.user = { id: "web", username: "guest", displayName: "Khách (web)", role: "admin", scope: null, scopeName: null };
    state.view = "map";
    showView("map");
    highlightTab("map");
    $("currentUserName").textContent = "Chế độ trình duyệt";
    $("currentUserRole").textContent = "Xem bản đồ công khai";
    $("titleBarScope").textContent = "Chế độ web (không có quyền quản trị)";
    // Tab quản trị không khả dụng ngoài Electron.
    for (const node of document.querySelectorAll("[data-admin-only]")) setHidden(node, true);
    buildRegionSelects();
    state.locations = typeof khanhHoaWeb?.publicLocations === "function" ? await khanhHoaWeb.publicLocations() : [];
    applyLocationFilters();
    refreshMapSize();
  }

  /* ================================ Events ================================= */

  function bindEvents() {
    $("loginForm").addEventListener("submit", handleLogin);
    $("logoutButton").addEventListener("click", handleLogout);
    $("openProfile").addEventListener("click", openProfile);
    $("closeProfile").addEventListener("click", closeProfile);
    $("cancelProfile").addEventListener("click", closeProfile);
    $("profileForm").addEventListener("submit", handleProfileSubmit);

    // Header tabs: click + bàn phím (role=tablist, tab hợp lệ duy nhất có tabindex=0).
    for (const button of VIEW_BUTTONS()) {
      button.addEventListener("click", () => {
        if (button.hidden) return;
        openView(button.dataset.view);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const tabs = VIEW_BUTTONS().filter((node) => !node.hidden);
        const index = tabs.indexOf(button);
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + step + tabs.length) % tabs.length];
        next.focus();
        openView(next.dataset.view);
      });
    }

    // Thông báo
    if ($("bellButton")) {
      $("bellButton").addEventListener("click", () => toggleNotificationPanel());
      $("markAllReadButton").addEventListener("click", async () => {
        const result = await api("notifications:readAll", { sessionId: state.sessionId });
        if (result.ok) {
          state.notifications = result.notifications;
          state.unread = result.unread;
          state.emergencyUnread = result.emergencyUnread;
          renderBell();
          renderNotificationList();
          hide($("emergencyBanner"));
        }
      });
      $("notifyReviewersButton").addEventListener("click", handleRemindReviewers);
      // Bấm ra ngoài thì đóng panel thông báo.
      document.addEventListener("click", (event) => {
        const panel = $("notificationPanel");
        if (!panel || panel.classList.contains("hidden")) return;
        if (event.target.closest("#notificationPanel") || event.target.closest("#bellButton")) return;
        toggleNotificationPanel(false);
      });
    }

    // Sửa tài khoản / Đặt lại mật khẩu
    $("editAccountForm").addEventListener("submit", handleEditAccountSubmit);
    $("cancelEditAccount").addEventListener("click", closeEditAccount);
    $("closeEditAccount").addEventListener("click", closeEditAccount);
    $("editAccountModal").addEventListener("click", (event) => {
      if (event.target === $("editAccountModal")) closeEditAccount();
    });
    $("resetPasswordForm").addEventListener("submit", handleResetPasswordSubmit);
    $("cancelResetPassword").addEventListener("click", closeResetPassword);
    $("closeResetPassword").addEventListener("click", closeResetPassword);
    $("resetPasswordModal").addEventListener("click", (event) => {
      if (event.target === $("resetPasswordModal")) closeResetPassword();
    });

    // Quản lý nhóm thông tin (Cấp Tỉnh)
    if ($("addCategoryButton")) $("addCategoryButton").addEventListener("click", () => openCategoryModal());
    $("categoryForm").addEventListener("submit", handleCategorySubmit);
    $("cancelCategoryModal").addEventListener("click", closeCategoryModal);
    $("closeCategoryModal").addEventListener("click", closeCategoryModal);
    $("categoryLabel").addEventListener("input", updateCategoryPreview);
    $("categoryIcon").addEventListener("input", () => {
      renderIconPicker();
      updateCategoryPreview();
    });
    $("categoryModal").addEventListener("click", (event) => {
      if (event.target === $("categoryModal")) closeCategoryModal();
    });

    // Quản lý đơn vị hành chính
    if ($("addWardButton")) $("addWardButton").addEventListener("click", () => openWardModal());
    $("wardForm").addEventListener("submit", handleWardSubmit);
    $("cancelWardModal").addEventListener("click", closeWardModal);
    $("closeWardModal").addEventListener("click", closeWardModal);
    $("wardModal").addEventListener("click", (event) => {
      if (event.target === $("wardModal")) closeWardModal();
    });


    $("wardFilter").addEventListener("change", () => {
      state.filters.wardId = $("wardFilter").value;
      applyLocationFilters();
      flyToFilterArea();
    });
    // Áp dụng ngay khi danh sách ghim vừa được nạp lại (VD: sau khi duyệt).
    $("wardFilter").addEventListener("input", applyLocationFilters);

    $("categoryFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.activeCategory = button.dataset.category;
      for (const item of document.querySelectorAll(".category-button")) {
        const active = item === button;
        item.classList.toggle("bg-teal-700", active);
        item.classList.toggle("border-teal-700", active);
        item.classList.toggle("text-white", active);
        item.classList.toggle("bg-white", !active);
        item.classList.toggle("border-slate-200", !active);
        item.classList.toggle("text-slate-700", !active);
      }
      applyLocationFilters();
    });

    $("locateButton").addEventListener("click", () => {
      map.flyTo(PROVINCE_CENTER, PROVINCE_ZOOM, { duration: 0.6 });
      state.filters.regionId = "all";
      $("wardFilter").value = "all";
      rebuildWardFilter();
      applyLocationFilters();
    });

    // Feedback form (public + in-app)
    $("openPublicForm").addEventListener("click", () => openFeedbackModal());
    $("openFeedbackFromApp").addEventListener("click", () => openFeedbackModal());
    // "Phản hồi tôi đã gửi": chỉ dữ liệu của CHÍNH thiết bị này.
    if ($("openMyFeedback")) $("openMyFeedback").addEventListener("click", openMyFeedback);
    if ($("closeMyFeedback")) $("closeMyFeedback").addEventListener("click", closeMyFeedback);
    if ($("myFeedbackModal")) {
      $("myFeedbackModal").addEventListener("click", (event) => {
        if (event.target === $("myFeedbackModal")) closeMyFeedback();
      });
    }
    // Bản đồ công khai chỉ xem, KHÔNG có tài khoản/phiên đăng nhập.
    $("openPublicMap")?.addEventListener("click", () => {
      state.sessionId = null;
      state.user = { id: "guest", username: "guest", displayName: "Khách", role: "citizen", scope: null, scopeName: null, guest: true };
      state.regions = state.regions.length ? state.regions : FALLBACK_REGIONS;
      showAppView();
    });
    $("closeFeedbackModal").addEventListener("click", closeFeedbackModal);
    $("cancelFeedback").addEventListener("click", closeFeedbackModal);
    $("feedbackForm").addEventListener("submit", submitFeedback);
    // Đổi phường/xã -> đồng bộ khu vực ẩn + nạp lại danh sách thôn/tổ dân phố.
    $("feedbackWard").addEventListener("change", () => {
      syncFeedbackRegion();
      rebuildFeedbackHamlets();
    });
    $("gpsButton").addEventListener("click", useGps);
    $("pickOnMapButton").addEventListener("click", () => {
      if (state.pickingOnMap) {
        setPickingMode(false);
        openFeedbackModal();
        return;
      }
      closeFeedbackModal();
      setPickingMode(true);
    });
    $("pickImagesButton").addEventListener("click", pickImages);
    $("imageFileInput")?.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []).slice(0, MAX_IMAGES);
      const room = MAX_IMAGES - state.pendingImages.length;
      for (const file of files.slice(0, room)) state.pendingImages.push({ name: file.name, file, savedId: null });
      renderPendingImages();
      event.target.value = "";
    });

    // Queue filters
    for (const button of document.querySelectorAll(".status-btn")) {
      button.addEventListener("click", async () => {
        state.feedback.status = button.dataset.status;
        await loadQueue();
      });
    }

    // Accounts
    $("createAccountForm").addEventListener("submit", handleCreateAccount);
    $("accountRegion").addEventListener("change", rebuildAccountWards);
    $("accountWard").addEventListener("change", updateAccountWardMeta);
    $("accountFilterRegion").addEventListener("change", renderAccountList);
    $("accountFilterRegion").addEventListener("input", renderAccountList);
    if ($("accountSearch")) {
      $("accountSearch").addEventListener("input", renderAccountList);
      $("accountSearch").addEventListener("search", renderAccountList);
    }

    // Keyboard
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("resetPasswordModal").classList.contains("hidden")) {
        closeResetPassword();
        return;
      }
      if (!$("editAccountModal").classList.contains("hidden")) {
        closeEditAccount();
        return;
      }
      if (!$("myFeedbackModal").classList.contains("hidden")) {
        closeMyFeedback();
        return;
      }
      toggleNotificationPanel(false);
      if (!$("categoryModal").classList.contains("hidden")) closeCategoryModal();
      else if (!$("wardModal").classList.contains("hidden")) closeWardModal();
      else if (!$("feedbackModal").classList.contains("hidden")) closeFeedbackModal();
      else if (!$("profileModal").classList.contains("hidden")) closeProfile();
    });
    for (const id of ["feedbackModal", "profileModal"]) {
      $(id).addEventListener("click", (event) => {
        if (event.target !== $(id)) return;
        if (id === "feedbackModal") closeFeedbackModal();
        else closeProfile();
      });
    }
  }

  /* ================================= Boot ================================== */

  async function boot() {
    if (state.booted) return;
    state.booted = true;

    initMap();
    bindEvents();
    renderPendingImages();

    if (!isDesktop()) {
      await startWebMode();
      return;
    }

    await loadRegions();
    buildRegionSelects();
    // Biểu mẫu tạo tài khoản cần tồn tại trong DOM trước khi tính gợi ý địa bàn.
    updateAccountWardMeta();
    const info = await api("app:info");
    if (info.ok) document.title = `Bản đồ Yêu thương Khánh Hòa v${info.version}`;
    // Người dùng có thể đã đăng nhập xong trong lúc boot đang nạp dữ liệu
    // (boot là async) — khi đó KHÔNG được kéo họ về màn hình đăng nhập.
    if (!state.sessionId) {
      showView("login");
      $("loginUsername").focus();
    }
  }

  document.addEventListener("DOMContentLoaded", boot, { once: true });
  if (document.readyState !== "loading") boot();
})();
