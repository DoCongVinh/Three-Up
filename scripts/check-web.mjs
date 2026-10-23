/**
 * Kiểm tra nhanh server web có đang chạy không.
 *   node scripts/check-web.mjs                 (mặc định http://localhost:3000)
 *   node scripts/check-web.mjs http://host:8080
 */
const base = process.argv[2] || `http://localhost:${process.env.PORT || 3000}`;

try {
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`HTTP ${res.status}`);
  console.log(`✅ Server đang chạy tại ${base} (${data.service} v${data.version})`);
} catch (error) {
  console.error(`❌ Không kết nối được ${base}: ${error.cause?.code || error.message}`);
  console.error("   Hãy chạy server trước: npm run start:web");
  process.exitCode = 1;
}
