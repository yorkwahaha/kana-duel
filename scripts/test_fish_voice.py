"""快速連續試聽 Fish Audio 聲線。

使用方式：
1. 只修改下方 VOICE_ID。
2. 確認環境變數 FISH_AUDIO_API_KEY 已設定。
3. 在專案根目錄執行：python scripts/test_fish_voice.py

每次執行都會建立新的 outputs/fish-voice-tests/<時間>-<聲線前八碼>/，
不會覆蓋先前的測試檔案。
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


# ===== 平常只需要修改這一行 =====
VOICE_ID = "92428785fd3e457bbe228b39f16c39e6"

# 如 Fish Audio 日後更新模型，再修改這一行。
MODEL = "s2.1-pro-free"

API_URL = "https://api.fish.audio/v1/tts"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_ROOT = PROJECT_ROOT / "outputs" / "fish-voice-tests"

# (檔名, 讀音, 顯示文字, 中文)
words = [
    ("カメラ", "camera_word"),
    ("ラジオ", "rajio"),
    ("ニュース", "nyuusu"),
    ("インターネット", "intaanetto"),
    ("スマホ", "sumaho"),
    ("アプリ", "apuri"),
    ("メール", "meeru"),
    ("パスワード", "pasuwaado"),
    ("ゲーム", "geemu"),
    ("アニメ", "anime_word"),
    ("マンガ", "manga_word"),
    ("スポーツ", "supootsu"),
    ("サッカー", "sakkaa"),
    ("テニス", "tenisu"),
    ("バスケット", "basuketto"),
    ("バレーボール", "bareebooru"),
    ("ピアノ", "piano"),
    ("ギター", "gitaa"),
    ("コンサート", "konsaato"),
    ("ドラマ", "dorama"),
    ("チャンス", "chansu"),
    ("メモ", "memo"),
    ("ノート", "nooto"),
    ("ペン", "pen"),
    ("プレゼント", "purezento"),
    ("パーティー", "paatii"),
    ("リュックサック", "ryukkusakku"),
    ("ペット", "petto"),
    ("ドクター", "dokutaa"),
    ("スケジュール", "sukejuuru"),
]


def is_mp3(data: bytes) -> bool:
    """接受 ID3 或 MPEG frame sync 開頭的 MP3。"""
    return (
        len(data) > 3
        and (
            data[:3] == b"ID3"
            or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0)
        )
    )


def synthesize(api_key: str, voice_id: str, prompt: str, speed: float = 1.0) -> bytes:
    payload = json.dumps(
        {
            "text": prompt,
            "reference_id": voice_id,
            "format": "mp3",
            "sample_rate": 44100,
            "mp3_bitrate": 128,
            "latency": "normal",
            "normalize": True,
            "temperature": 0.2,
            "top_p": 0.5,
            "max_new_tokens": 128,
            "repetition_penalty": 1.4,
            "min_chunk_length": 0,
            "condition_on_previous_chunks": False,
            "early_stop_threshold": 0.8,
            "prosody": {
                "speed": speed,
                "volume": 0,
                "normalize_loudness": True,
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")

    request = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "model": MODEL,
        },
    )

    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                audio = response.read()
            if not is_mp3(audio):
                raise RuntimeError(f"Fish Audio 回傳的不是 MP3（{len(audio)} bytes）")
            return audio
        except urllib.error.HTTPError as error:
            detail = error.read(300).decode("utf-8", errors="replace")
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f"Fish Audio HTTP {error.code}: {detail}") from error
            retry_after = error.headers.get("Retry-After", "")
            delay = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else 2**attempt * 2
            print(f"暫時性錯誤 {error.code}，{delay:g} 秒後重試……")
            time.sleep(min(delay, 30))
        except urllib.error.URLError as error:
            if attempt == 3:
                raise RuntimeError(f"無法連線 Fish Audio：{error.reason}") from error
            delay = 2**attempt * 2
            print(f"連線失敗，{delay} 秒後重試……")
            time.sleep(delay)

    raise RuntimeError("Fish Audio 重試結束但沒有取得音檔")


def generation_items() -> list[dict[str, str]]:
    """同時接受 Sonnet 的 words 兩欄格式與原本的 SAMPLES 四欄格式。"""
    raw_words = globals().get("words")
    if raw_words:
        items = []
        for prompt, key in raw_words:
            items.append(
                {
                    "id": str(key),
                    "reading": "",
                    "written": "",
                    "zh": "",
                    "prompt": str(prompt),
                }
            )
        return items

    raw_samples = globals().get("SAMPLES")
    if raw_samples:
        items = []
        for key, reading, written, chinese in raw_samples:
            items.append(
                {
                    "id": str(key),
                    "reading": str(reading),
                    "written": str(written),
                    "zh": str(chinese),
                    "prompt": f"[日本語で「{reading}」と読んで]{written}",
                }
            )
        return items

    raise ValueError("找不到 words 或 SAMPLES 單字清單")


def main() -> int:
    voice_id = VOICE_ID.strip()
    api_key = os.environ.get("FISH_AUDIO_API_KEY", "").strip()

    if len(voice_id) != 32 or any(char not in "0123456789abcdefABCDEF" for char in voice_id):
        print("錯誤：請先把 VOICE_ID 改成 Fish Audio 的 32 碼聲音 ID。", file=sys.stderr)
        return 2
    if not api_key:
        print("錯誤：找不到環境變數 FISH_AUDIO_API_KEY。", file=sys.stderr)
        return 2

    try:
        items = generation_items()
    except (TypeError, ValueError) as error:
        print(f"錯誤：單字清單格式不正確：{error}", file=sys.stderr)
        return 2

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_dir = OUTPUT_ROOT / f"{timestamp}-{voice_id[:8]}"
    output_dir.mkdir(parents=True, exist_ok=False)

    records = []
    print(f"聲線：{voice_id}")
    print(f"輸出：{output_dir}")
    for index, item in enumerate(items, start=1):
        prompt = item["prompt"]
        key = item["id"]
        print(f"[{index}/{len(items)}] {prompt}")
        audio = synthesize(api_key, voice_id, prompt)
        safe_key = "".join(character for character in key if character.isalnum() or character in "-_") or f"sample-{index}"
        filename = f"{index:02d}-{safe_key}.mp3"
        file_path = output_dir / filename
        file_path.write_bytes(audio)
        records.append(
            {
                "id": key,
                "reading": item["reading"],
                "written": item["written"],
                "zh": item["zh"],
                "prompt": prompt,
                "file": filename,
                "bytes": len(audio),
            }
        )
        time.sleep(0.75)

    manifest = {
        "provider": "Fish Audio",
        "model": MODEL,
        "referenceId": voice_id,
        "generatedAt": datetime.now().astimezone().isoformat(),
        "records": records,
    }
    (output_dir / "pack.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"\n完成：{len(records)} 個 MP3")
    print(f"資料夾：{output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
