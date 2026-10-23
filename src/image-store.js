/**
 * Ảnh đính kèm: chỉ nhận file ảnh, đổi tên an toàn, giới hạn dung lượng.
 * Ảnh lưu ở <userData>/images/<feedbackId>/<file> và renderer truy cập qua
 * giao thức app-image:// (đăng ký trong main.js).
 */

import { copyFileSync, renameSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { createId } from "./data-model.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB / ảnh
export const MAX_IMAGES = 5;
export const ALLOWED_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".webp"]);

export function isAllowedImage(filePath) {
  return ALLOWED_EXTENSIONS.includes(extname(String(filePath)).toLowerCase());
}

/**
 * Sao chép ảnh người dùng chọn vào thư mục dữ liệu.
 * @returns {{ ok: boolean, saved?: {name: string, originalName: string, size: number}, errors?: string[] }}
 */
export function saveImage({ sourcePath, imagesRoot, feedbackId }) {
  if (!sourcePath || typeof sourcePath !== "string") {
    return { ok: false, errors: ["Không có tệp ảnh để lưu."] };
  }
  if (!isAllowedImage(sourcePath)) {
    return { ok: false, errors: [`Chỉ nhận ảnh ${ALLOWED_EXTENSIONS.join(", ")}.`] };
  }
  let size;
  try {
    size = statSync(sourcePath).size;
  } catch {
    return { ok: false, errors: ["Không đọc được tệp ảnh đã chọn."] };
  }
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, errors: [`Ảnh vượt quá ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`] };
  }

  const extension = extname(sourcePath).toLowerCase();
  const name = `${createId("img")}${extension}`;
  const targetDir = resolve(imagesRoot, feedbackId);
  const target = resolve(targetDir, name);
  try {
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourcePath, target);
  } catch (error) {
    return { ok: false, errors: [`Không lưu được ảnh: ${error.message}`] };
  }
  return { ok: true, saved: { name, originalName: basename(sourcePath), size } };
}

export function safeJoin(root, target) {
  const rootPath = resolve(root);
  const full = normalize(join(rootPath, target));
  if (full !== rootPath && !full.startsWith(rootPath + sep)) return null;
  return full;
}

const FEEDBACK_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Lưu ảnh vào thư mục tạm (mỗi lần gửi 1 thư mục), main process chuyển
 * sang thư mục của phản hồi sau khi tạo bản ghi.
 */
export function savePendingImage({ sourcePath, imagesRoot }) {
  const pendingId = `pending-${randomUUID()}`;
  const result = saveImage({ sourcePath, imagesRoot, feedbackId: pendingId });
  if (!result.ok) return result;
  return { ...result, pendingId };
}

/** Di chuyển thư mục ảnh tạm vào thư mục của phản hồi vừa tạo. */
export function attachPendingImages({ imagesRoot, pendingId, feedbackId, names = [] }) {
  if (!FEEDBACK_ID_PATTERN.test(String(feedbackId))) {
    return { ok: false, errors: ["Mã phản hồi không hợp lệ."] };
  }
  if (!names.length) return { ok: true, moved: 0 };
  if (!pendingId || !/^pending-[0-9a-f-]{36}$/i.test(String(pendingId))) {
    return { ok: false, errors: ["Thiếu thư mục ảnh tạm."] };
  }
  const sourceDir = safeJoin(imagesRoot, pendingId);
  const targetDir = safeJoin(imagesRoot, feedbackId);
  if (!sourceDir || !targetDir) return { ok: false, errors: ["Đường dẫn ảnh không hợp lệ."] };
  let moved = 0;
  for (const name of names) {
    const from = safeJoin(sourceDir, name);
    const to = safeJoin(targetDir, name);
    if (!from || !to) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      renameSync(from, to);
      moved += 1;
    } catch {
      /* ảnh không chuyển được: bỏ qua, phản hồi vẫn được ghi nhận */
    }
  }
  removeDir(sourceDir);
  return { ok: true, moved };
}

function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* bỏ qua */
  }
}

/** Đường dẫn renderer dùng trong <img src>. */
export function imageUrl(feedbackId, name) {
  return `app-image://images/${encodeURIComponent(feedbackId)}/${encodeURIComponent(name)}`;
}
