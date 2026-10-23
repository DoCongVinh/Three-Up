# Bản đồ Yêu thương Khánh Hòa — Desktop App (Electron)

Ứng dụng Windows kết nối **điểm hỗ trợ – nhu cầu cộng đồng – quy trình xác minh của Phường/Xã**
trên nền tảng **Electron + HTML/JS + TailwindCSS + Leaflet (nền Google Maps)**.

## 1. Tính năng chính

| Khu vực | Nội dung |
|---|---|
| **Đăng nhập phân quyền** | 2 vai trò: **Cấp Tỉnh (admin)** và **Cán bộ Xã/Phường (ward)**. Phiên đăng nhập giữ ở main process, renderer chỉ nhận `sessionId` – mật khẩu hash `scrypt`. |
| **Quản lý tài khoản** (admin) | Tạo tài khoản cán bộ cho từng Phường/Xã; tài khoản được **tự động phân vào nhóm địa bàn** của thành phố/huyện tương ứng. Khóa/mở khóa tài khoản. |
| **Hàng đợi phản hồi** | Cán bộ chỉ thấy **đúng phản hồi thuộc địa bàn mình**. Duyệt (**Approve**) → điểm xuất hiện trên bản đồ công khai; từ chối phải ghi lý do. Admin chỉ xem, không duyệt thay. |
| **Form gửi phản hồi** (người dân / mạnh thường quân) | **Tỉnh Khánh Hòa cố định** (không sửa được) → **Khu vực** (nhóm địa lý để chọn nhanh — sau sáp nhập **không còn cấp Thành phố/Huyện**) → **Phường/Xã** → **Thôn/Tổ dân phố**. Bắt buộc: Họ tên, SĐT, Email, Địa chỉ, Lý do. **GPS tự động** hoặc **chọn trên bản đồ**. **Đính kèm tối đa 5 ảnh**. |
| **Danh sách phân loại Xã/Phường** | Thẻ theo Thành phố/Huyện → click xem chi tiết từng phường/xã (tên cũ sau sáp nhập, thôn/tổ dân phố, số tài khoản, chờ duyệt, đã duyệt). **Cấp Tỉnh** có nút **＋ Thêm phường/xã**, mỗi dòng có **Sửa** / **Xóa** (chỉ xóa được khi đơn vị đã sạch tài khoản và phản hồi). |
| **Bản đồ** | Ghim theo nhóm (Điểm hỗ trợ / Chính sách / Nhu cầu / Khẩn cấp), popup có tên, địa chỉ, SĐT, chỉ đường Google Maps; lọc theo địa bàn + nhóm. |

### Bốn tab của workspace

| Tab | Nội dung |
|---|---|
| 🗺️ **Bản đồ** | Sidebar lọc **một dropdown Phường/Xã** (16 đơn vị, nhóm theo khu vực để dễ tìm; chọn là **bản đồ tự bay tới**). Danh sách điểm đã duyệt, chú giải màu, nút về toàn tỉnh. |
| 📨 **Phản hồi** | Hàng đợi của đúng địa bàn cán bộ (mặc định *Chờ duyệt*; hết mục chờ thì tự chuyển *Tất cả*). Chi tiết: người gửi, nội dung, **hình ảnh**, **toạ độ GPS + chỉ đường**, lịch sử xử lý, nút **“✓ Xác nhận / Phê duyệt”** (chọn thời hạn hiển thị) và “✕ Từ chối” (bắt buộc ghi chú). Admin xem tất cả nhưng không duyệt thay. |
| 🔔 **Thông báo & hạn hiển thị** | Khi người dân gửi, Cán bộ Xã/Phường **đúng địa bàn** nhận thông báo; nhóm *Thông tin khẩn cấp* → cảnh báo **“Trường hợp khẩn cấp”** (banner đỏ + chuông + rung/âm báo). Điểm đã duyệt hiển thị **4 ngày**, cán bộ có thể **gia hạn +4/+7/+30 ngày** hoặc **gắn vĩnh viễn**. Admin có nút **“📣 Nhắc cán bộ duyệt phản hồi”**. |
| 📊 **Xã/Phường** | **Danh sách phẳng 16 phường/xã** (2 cấp, không còn huyện): mỗi thẻ là 1 phường/xã kèm số tài khoản, điểm đã công bố, phản hồi. Click thẻ → chi tiết (tên cũ sau sáp nhập, danh sách thôn/tổ dân phố, nút Sửa / Xóa / Tạo tài khoản / Xem trên bản đồ). |
| 👥 **Tài khoản** (admin) | Form tạo tài khoản cán bộ theo địa bàn (gợi ý địa bàn đã có cán bộ chưa), báo rõ tài khoản được xếp vào nhóm nào; danh sách tài khoản nhóm theo Thành phố/Huyện, khóa/mở khóa, lọc + tìm kiếm không dấu. Cuối tab có mục **Nhóm thông tin**: thêm/sửa/xoá nhóm (VD: Người khuyết tật, Nhà thương binh) — nhóm mới hiện ngay trong form gửi phản hồi, bộ lọc bản đồ và chú giải. |

Tab được chuyển bằng nút trên header (hoặc phím ← →), trạng thái active thể hiện qua `aria-selected` + `.tab-active`;
riêng tab Bản đồ gọi `map.invalidateSize()` sau khi hiện lại để khung bản đồ không bị xám.

## 2. Cài đặt & chạy

```powershell
# Yêu cầu: Node.js >= 20, Windows 10/11 x64
npm install          # cài electron + electron-builder
npm start            # chạy ứng dụng desktop
npm test             # chạy unit test (node:test, không cần mạng)
```

> Trong PowerShell nếu `npm` bị chặn script, dùng `cmd /c npm start` hoặc
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Tài khoản mặc định (lần chạy đầu)

| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Cấp Tỉnh | `admin` | `Admin@2025` |

- Đổi mật khẩu trong **Hồ sơ** (góc trên phải). Trong mã nguồn, tên/mật khẩu admin khởi tạo
  được đặt tại `src/data-store.js` (`DEFAULT_ADMIN`, `seedAdminPassword`).
- Tài khoản cán bộ do admin tạo trong tab **👥 Tài khoản** — chọn Thành phố/Huyện → Phường/Xã →
  Họ tên → Tên đăng nhập → Mật khẩu ban đầu (≥ 8 ký tự).

## 3. Đóng gói ra file `.exe`

```powershell
npm run dist         # NSIS installer + bản Portable, xuất ra thư mục release\
npm run dist:dir     # chỉ build thư mục app (không tạo installer) – nhanh để kiểm tra
```

Kết quả trong `release\`:

- `BanDoYeuThuongKhanhHoa-Setup-2.0.0.exe` — bộ cài (chọn thư mục, tạo shortcut Desktop/Start Menu).
- `BanDoYeuThuongKhanhHoa-Portable-2.0.0.exe` — bản chạy ngay, không cần cài.

Ghi chú:

- Cấu hình đóng gói nằm trong `"build"` của `package.json` (`nsis`, `portable`, `artifactName`).
- Biểu tượng: `build/icon.ico` (256×256). Tạo lại bằng `npm run icon`.
- Lần build đầu tiên cần Internet để tải `winCodeSign`/NSIS; sau đó có thể build offline.
- Nếu Windows SmartScreen cảnh báo khi chạy file chưa ký số, chọn *More info → Run anyway*
  (bản phát hành chính thức cần chứng thư code-signing).

## 4. Dữ liệu lưu ở đâu?

Tất cả nằm trên máy, không gửi lên server:

```
%APPDATA%\BanDoYeuThuongKhanhHoa\
├── db.json              # users (hash mật khẩu), feedbacks, audit
├── db.json.bak          # bản sao lưu tự động sau mỗi lần ghi
└── images\
    └── <feedbackId>\img-xxxx.png
```

- Mở nhanh thư mục dữ liệu: menu **Tệp → Mở thư mục dữ liệu**.
- Muốn đặt dữ liệu ở chỗ khác (VD: ổ USB): đặt biến môi trường `KHANHHOA_USER_DATA` trước khi chạy.
- Đổi mật khẩu admin lần khởi tạo đầu: `KHANHHOA_ADMIN_PASSWORD`.
- File `db.json` hỏng sẽ được sao lưu thành `db.json.corrupted-<timestamp>.json` và ứng dụng tự tạo mới.

## 5. Cấu trúc mã nguồn

```
main.js                 # Main process: BrowserWindow 1200x800, menu tiếng Việt, IPC, protocol ảnh
preload.cjs             # contextBridge: window.khanhHoa.request(channel, payload)
index.html              # Giao diện (Tailwind CDN + Leaflet CDN)
app.js                  # Renderer: login, phân quyền UI, form, hàng đợi duyệt, thống kê, bản đồ
src/data-model.js       # Danh mục địa bàn, validate, phân quyền, thống kê (dùng chung)
src/notifications.js    # Hạn hiển thị (4 ngày / gia hạn / vĩnh viễn) + thông báo khẩn cấp, nhắc duyệt
src/administrative-units.js  # Danh mục 3 tầng: Huyện/TP → Phường/Xã → Thôn/Tổ dân phố (seed)
src/data-store.js       # JSON DB: hash scrypt, CRUD user/feedback/địa bàn, audit, ghi an toàn
src/app-service.js      # Use-cases + session/authorization (8 giờ, hủy khi khóa tài khoản)
src/ipc-router.js       # Danh sách kênh IPC, chuẩn hóa lỗi { ok, code, errors }
src/image-store.js      # Lưu/chuyển ảnh an toàn (chặn path traversal, giới hạn 5MB)
build/icon.ico|.png     # Biểu tượng ứng dụng
scripts/generate-icon.mjs
tests/                  # node:test
```

### Bảo mật

- `contextIsolation: true`, `nodeIntegration: false`, không expose Node cho renderer.
- Mọi IPC qua **một kênh** `khanhhoa:request` với danh sách kênh cố định; kiểm tra nguồn gọi
  phải là `file://` của ứng dụng.
- Ở renderer, nội dung động được tạo bằng `createElement` + `textContent` (không dùng
  `innerHTML` với dữ liệu người dùng) → chống XSS.
- Phân quyền kiểm tra **hai lớp**: ẩn/hiện UI + xác thực lại ở service/main (ward chỉ duyệt địa bàn
  mình; admin không duyệt thay).

## 6. IPC API (tóm tắt)

| Kênh | Quyền | Mô tả |
|---|---|---|
| `auth:login` / `auth:logout` / `auth:me` / `auth:changePassword` | – | phiên đăng nhập |
| `accounts:list` / `accounts:create` / `accounts:setActive` | admin | quản lý tài khoản cán bộ |
| `directory:regions` / `directory:wards` / `directory:statistics` / `directory:region` | đã đăng nhập | đơn vị hành chính + thống kê |
| `feedback:submit` | công khai | người dân gửi phản hồi (validate ở main) |
| `feedback:list` / `feedback:review` | ward (đúng địa bàn) | hàng đợi & duyệt |
| `feedback:publicLocations` | công khai | điểm đã duyệt để vẽ bản đồ |
| `dialog:pickImages` / `image:save` / `image:url` | – | đính kèm ảnh |
| `dashboard:summary` / `profile:update` / `app:info` | đã đăng nhập | phụ trợ |

Mọi phản hồi có dạng `{ ok: true, ... }` hoặc `{ ok: false, code, errors: [...] }`.

## 7. Kiểm thử

```powershell
npm test
```

- `tests/unit/model.test.js` — validate dữ liệu, phân quyền duyệt, thống kê, khoảng cách.
- `tests/unit/backend.test.js` — DataStore + AppService: hash mật khẩu, đăng nhập, khóa tài khoản,
  phiên hết hạn, luồng submit → pending → approve → bản đồ.
- `tests/unit/ipc.test.js` — envelope IPC, lỗi không lộ stack, lưu ảnh & chặn path traversal.
- `tests/unit/ui.test.js` — chạy `app.js` thật trên DOM thật (parser nhẹ) với backend thật.

Kiểm tra tính toàn vẹn giao diện (không cần chạy Electron):

```powershell
node scripts/check-dom-ids.mjs   # mọi $("id") trong app.js đều có phần tử trong index.html
node --check app.js              # cú pháp renderer
```

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Cửa sổ trắng / không tải bản đồ | Máy cần Internet để tải Tailwind/Leaflet/OSM (CDN). Bản đồ vẫn mở nhưng không có ảnh nền nếu offline. |
| Bản đồ bị xám sau khi chuyển tab | Đã xử lý: tab Bản đồ gọi `map.invalidateSize()` sau khi hiện lại và bỏ qua khi container đang 0×0. Nếu vẫn gặp, mở DevTools (menu **Xem → Công cụ nhà phát triển**) xem lỗi console. |
| **Bản đồ không tải được tile Google (nền xám)** | Ứng dụng hiện khung cảnh báo trên bản đồ sau 2 tile lỗi, kèm nút **Thử lại**. Kiểm tra bằng menu **Tệp → Kiểm tra tải bản đồ…** (tải thử mt0–mt3.google.com; kết quả hiện trong hộp thoại và terminal). Nếu lỗi: firewall/proxy đang chặn `*.google.com` — cần mở tên miền này. |
| Ghi chú về nền bản đồ | Ứng dụng chỉ dùng **Google Maps** (đã bỏ OpenStreetMap). Tile lấy từ endpoint `mt0–mt3.google.com/vt` — đây là endpoint không chính thức của Google, **không có SLA và có thể bị chặn/đổi bất kỳ lúc nào**. Khi triển khai chính thức nên dùng Google Maps Platform (API key, có phí) hoặc tile server nội bộ. |
| Không lấy được GPS | Bấm **Chọn trên bản đồ** để đặt điểm thủ công. |
| Quên mật khẩu admin | Đóng ứng dụng, sao lưu rồi xóa `db.json` trong thư mục dữ liệu → lần chạy sau tạo lại `admin` / `Admin@2025`. |
| `npm run dist` lỗi tải file | Kiểm tra mạng/proxy; thử lại `npm run dist` (electron-builder dùng cache ở `%LOCALAPPDATA%\electron-builder`). |
