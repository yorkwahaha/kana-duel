# 聲の仮名 · 墨域言靈闘場

**v1.1** — 假名聽音拼字對決（單人練習／本機雙人／線上雙人）。

2.5D 墨域格鬥立繪 + 羅馬拼音對決 + COMBO 連打 + 大招影片。

## 線上版

部署於 GitHub Pages（推送後約 1 分鐘生效）：

**https://yorkwahaha.github.io/kana-duel/**

## 本機啟動

```powershell
cd I:\Projects\kana-voice-match-prototype
python -m http.server 8001
```

開 **http://localhost:8001**（TTS 建議此來源）。

## 線上雙人

首頁選擇「線上對戰」後，可建立六碼匿名房間或輸入房號加入。房主設定競速／聽力、題庫類別、題目長度、假名種類與干擾項；雙方各自選角並準備後自動開戰。

線上模式比照 JP Match 的房間架構，採 Cloudflare Worker + Durable Objects + WebSocket：

- 伺服器判定答案、HP、蓄力、COMBO、攻擊、格擋與角色技能，前端只送操作指令。
- 房號與匿名連線憑證保存在瀏覽器，可在短暫斷線後自動重連。
- 對手離線時伺服器拒絕戰鬥指令，畫面會暫停；主動離房則釋放座位並轉移房主。
- 每台裝置只收到自己的當前題目 ID；對手題目索引與完整題目順序不會出現在房間快照。
- 線上戰鬥採單一玩家視角：直式為上方戰況、下方全寬作答；橫式為左側雙方戰鬥演出、右側自己的作答與技能。
- 本機雙人仍維持原本上下對坐與 P2 旋轉畫面，不受線上排版影響。

前端預設連到 `https://kana-voice-match-online.yorkwahaha.workers.dev`。首次上線前需先部署 `worker/`，再發布 GitHub Pages；操作與驗證方式見 [`worker/README.md`](worker/README.md)。

## 角色媒體

| 類型 | 路徑 |
|------|------|
| 立繪／攻擊／受擊姿勢 | `assets/characters/{ao,rin,ya,go,ran,gen,sho,yo}{.webp,-atk.webp,-hit.webp}` |
| 大招影片（約 6 秒，內建喊招／音效） | `assets/anim/{id}-cast.mp4` |
| 受擊 | `assets/voice/{id}/hit.mp3` |
| 敗北 | `assets/voice/{id}/defeat.mp3` |
| 戰鬥 BGM×3 | `assets/bgm/battle-{1,2,3}.ogg`（Opus ~96k） |
| 連打音效 | `assets/sfx/hit{1..5}.mp3` |

大招：播角色 `*-cast.mp4`（缺檔則立繪約 3 秒）；結束後接連打結算。

## 對戰規則摘要

同序題庫、各自推進；答對累積蓄力／COMBO／大招槽（8 題滿）；攻擊依 COMBO 連打；槽滿可放大招。答錯依錯格數自傷。

## v1.0 範圍

本版本暫結：封面進場、雙人選角、羅馬字格內作答、攻擊／大招、敗北黑白立繪。後續迭代另開。
