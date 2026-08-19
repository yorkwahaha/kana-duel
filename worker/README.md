# 線上對戰 Worker

這個 Worker 提供六碼匿名房間、Durable Object 權威戰鬥狀態與 WebSocket 即時同步。

## 本機測試

先在專案根目錄啟動前端：

```powershell
python -m http.server 8001
```

另一個終端啟動 Worker：

```powershell
npx wrangler dev --config worker/wrangler.jsonc
```

本機前端會自動使用 `http://127.0.0.1:8787`。

## 部署

登入正確的 Cloudflare 帳號後：

```powershell
npx wrangler deploy --config worker/wrangler.jsonc
```

部署後確認：

1. `https://kana-voice-match-online.yorkwahaha.workers.dev/health` 回傳 `ok: true`。
2. `worker/wrangler.jsonc` 的 `ALLOWED_ORIGINS` 包含正式 GitHub Pages 來源與本機 `8001`。
3. 以兩個獨立瀏覽器建立／加入同房，確認雙方準備、答題、攻擊、技能、斷線暫停、重連與離房。
4. Worker 驗證完成後再發布前端，避免線上入口先指向不存在的服務。
