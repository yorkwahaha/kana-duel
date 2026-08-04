# 戰鬥 BGM

請將三首音檔放到此資料夾，檔名需為：

- `battle-1.ogg`
- `battle-2.ogg`
- `battle-3.ogg`

格式建議：Opus in Ogg、約 96 kbps（體積小、聽感接近原 192k MP3）。

對戰開始時會隨機選一首循環播放；結束或回首頁會停止。

# 連打音效（建議）

可選：在 `assets/sfx/` 放置越打越痛的音效：

- `hit1.mp3` … `hit5.mp3`

若缺檔，程式會改用現有的 `sfx_hit.mp3` 並提高音量模擬層級。
