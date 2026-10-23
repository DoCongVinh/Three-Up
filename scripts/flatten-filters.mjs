/** app.js: bỏ phụ thuộc vào ô "Khu vực" đã ẩn -> dùng 1 dropdown phẳng phường/xã. */
import { readFileSync, writeFileSync } from "node:fs";

const file = "app.js";
let s = readFileSync(file, "utf8");

/** Thay đúng 1 lần; báo lỗi nếu không thấy hoặc thấy nhiều chỗ. */
function once(search, replacement, label) {
  const parts = s.split(search);
  if (parts.length !== 2) throw new Error(`${label}: khớp ${parts.length - 1} lần`);
  s = parts.join(replacement);
  console.log("ok -", label);
}

// 1) Bộ lọc: suy ra khu vực từ phường/xã
once(
  `    // Bộ lọc luôn phản ánh giá trị hiện tại của 2 dropdown.
    state.filters.regionId = $("regionSelect").value || "all";
    state.filters.wardId = $("wardFilter").value || "all";`,
  `    // Chỉ có 1 dropdown: khu vực suy ra từ phường/xã đã chọn.
    state.filters.wardId = $("wardFilter").value || "all";
    state.filters.regionId = regionIdOfWard(state.filters.wardId) || "all";`,
  "applyLocationFilters");

// 2) showWardOnMap: chọn thẳng phường/xã
once(
  `    const region = state.regions.find((item) => item.wards.some((ward) => ward.id === wardId));
    if (region) {
      $("regionSelect").value = region.id;
      rebuildWardFilter();
      $("wardFilter").value = wardId;
    }`,
  `    rebuildWardFilter();
    if ($("wardFilter").options.some((option) => option.value === wardId)) $("wardFilter").value = wardId;`,
  "showWardOnMap");

// 3) openFeedbackModal prefill
once(
  `      const region = state.regions.find((item) => item.wards.some((ward) => ward.id === prefillWard));
      if (region && !isWard()) {
        $("feedbackRegion").value = region.id;
        rebuildFeedbackWards();
        $("feedbackWard").value = prefillWard;
      }`,
  `      if (!isWard() && $("feedbackWard").options.some((option) => option.value === prefillWard)) {
        $("feedbackWard").value = prefillWard;
        syncFeedbackRegion();
        rebuildFeedbackHamlets();
      }`,
  "openFeedbackModal prefill");

// 4) Event của dropdown ẩn "Khu vực" -> đổi sang phường/xã
once(
  `    $("feedbackRegion").addEventListener("change", rebuildFeedbackWards);
    // Đổi phường/xã -> nạp lại danh sách thôn/tổ dân phố tương ứng.
    $("feedbackWard").addEventListener("change", rebuildFeedbackHamlets);`,
  `    // Đổi phường/xã -> đồng bộ khu vực ẩn + nạp lại danh sách thôn/tổ dân phố.
    $("feedbackWard").addEventListener("change", () => {
      syncFeedbackRegion();
      rebuildFeedbackHamlets();
    });`,
  "feedbackWard change");

// 5) Bỏ listener của ô select khu vực
once(
  `    $("regionSelect").addEventListener("change", () => {
      state.filters.regionId = $("regionSelect").value;
      rebuildWardFilter();
      applyLocationFilters();
      // Tự động đưa bản đồ tới khu vực vừa chọn.
      flyToFilterArea();
    });`,
  ``,
  "regionSelect change listener");

once(
  `    for (const id of ["regionSelect", "wardFilter"]) {
      $(id).addEventListener("input", applyLocationFilters);
    }`,
  `    $("wardFilter").addEventListener("input", applyLocationFilters);`,
  "input listener");

// 6) locateButton
once(
  `      state.filters.regionId = "all";
      $("regionSelect").value = "all";
      rebuildWardFilter();`,
  `      state.filters.regionId = "all";
      $("wardFilter").value = "all";
      rebuildWardFilter();`,
  "locateButton");

// 7) Lọc danh sách tài khoản theo phường/xã
once(
  `    const filter = $("accountFilterRegion").value;
    const query = normalizeForSearch($("accountSearch") ? $("accountSearch").value : "");
    const region = state.regions.find((item) => item.id === filter);
    const visible = state.accounts.filter((account) => {
      const inRegion = filter === "all" || (region && region.wards.some((ward) => ward.id === account.scope));`,
  `    const filter = $("accountFilterRegion").value;
    const query = normalizeForSearch($("accountSearch") ? $("accountSearch").value : "");
    const visible = state.accounts.filter((account) => {
      const inRegion = filter === "all" || account.scope === filter;`,
  "renderAccountList filter");

writeFileSync(file, s);
console.log("hoàn tất");
