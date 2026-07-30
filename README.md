# 聲の仮名 · 墨域言靈闘場

**v1.0** — 假名聽音拼字對決原型（單人練習／雙人對戰）。

2.5D 墨域格鬥立繪 + 羅馬拼音對決 + COMBO 連打 + 大招影片。

## 線上版

部署於 GitHub Pages（推送後約 1 分鐘生效）：

**https://yorkwahaha.github.io/kana-voice-match-prototype/**

## 本機啟動

```powershell
cd I:\Projects\kana-voice-match-prototype
python -m http.server 8001
```

開 **http://localhost:8001**（TTS 建議此來源）。

## 角色媒體

| 類型 | 路徑 |
|------|------|
| 立繪 | `assets/characters/{ao,rin,ya,go}.png` |
| 大招影片（約 6 秒，內建喊招／音效） | `assets/anim/{id}-cast.mp4` |
| 受擊 | `assets/voice/{id}/hit.mp3` |
| 敗北 | `assets/voice/{id}/defeat.mp3` |
| 戰鬥 BGM×3 | `assets/bgm/battle-{1,2,3}.mp3` |
| 連打音效 | `assets/sfx/hit{1..5}.mp3` |

大招：播角色 `*-cast.mp4`（缺檔則立繪約 3 秒）；結束後接連打結算。

## 對戰規則摘要

同序題庫、各自推進；答對累積蓄力／COMBO／大招槽（8 題滿）；攻擊依 COMBO 連打；槽滿可放大招。答錯依錯格數自傷。

## v1.0 範圍

本版本暫結：封面進場、雙人選角、羅馬字格內作答、攻擊／大招、敗北黑白立繪。後續迭代另開。
