import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const API_URL = "https://api.fish.audio/v1/tts";
const API_KEY = process.env.FISH_AUDIO_API_KEY;
const ROOT = path.resolve(import.meta.dirname, "..");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const referenceId = arg("reference", process.env.FISH_AUDIO_REFERENCE_ID || "");
const category = arg("category", "food");
const model = arg("model", "s2.1-pro-free");
const promptMode = arg("prompt", "reading");
const writtenOverridesPath = arg("written-overrides");
const writtenOverrides = writtenOverridesPath
  ? JSON.parse(fs.readFileSync(path.resolve(writtenOverridesPath), "utf8"))
  : {};
const limit = Math.max(1, Number(arg("limit", "8")) || 8);
const selectedKeys = new Set(arg("keys").split(",").map((value) => value.trim()).filter(Boolean));
const outputDir = path.resolve(arg("out-dir", path.join(ROOT, "outputs", `fish-${category}-${referenceId.slice(0, 8)}`)));

if (!API_KEY) throw new Error("FISH_AUDIO_API_KEY is not set");
if (!/^[a-f0-9]{32}$/i.test(referenceId)) throw new Error("A 32-character Fish Audio reference id is required");
if (!new Set(["reading", "written", "japanese-written", "reading-kanji"]).has(promptMode)) throw new Error(`Unknown prompt mode: ${promptMode}`);

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadQuestions() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("questions-data.js"), sandbox, { filename: "questions-data.js" });
  vm.runInContext(read("questions-expansion-data.js"), sandbox, { filename: "questions-expansion-data.js" });
  return sandbox.window.KANA_QUESTIONS || [];
}

function isMp3(buffer) {
  return buffer.length > 3 && (
    buffer.subarray(0, 3).toString("ascii") === "ID3"
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  );
}

async function synthesize(text) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        model,
      },
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: "mp3",
        sample_rate: 44100,
        mp3_bitrate: 128,
        latency: "normal",
        normalize: true,
        temperature: 0.2,
        top_p: 0.5,
        max_new_tokens: 128,
        repetition_penalty: 1.4,
        min_chunk_length: 0,
        condition_on_previous_chunks: false,
        early_stop_threshold: 0.8,
        prosody: { speed: 1, volume: 0, normalize_loudness: true },
      }),
    });
    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (!isMp3(audio)) throw new Error(`Unexpected MP3 response (${audio.length} bytes)`);
      return audio;
    }
    const detail = (await response.text()).slice(0, 300);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw new Error(`Fish Audio ${response.status}: ${detail}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2_000 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)));
  }
  throw new Error("Fish Audio retry loop ended unexpectedly");
}

const candidates = loadQuestions()
  .filter((question) => question.category === category)
  .filter((question) => selectedKeys.size === 0 || selectedKeys.has(question.id))
  .slice(0, limit);

if (candidates.length === 0) throw new Error(`No questions found for category: ${category}`);
if (selectedKeys.size > 0 && candidates.length !== selectedKeys.size) {
  const found = new Set(candidates.map((question) => question.id));
  const missing = [...selectedKeys].filter((key) => !found.has(key));
  throw new Error(`Unknown or mismatched keys: ${missing.join(", ")}`);
}

fs.mkdirSync(outputDir, { recursive: true });
const records = [];
for (const question of candidates) {
  const filename = `${question.id}.mp3`;
  const written = writtenOverrides[question.id] || question.kanji || question.displayName || question.speakText;
  const prompt = promptMode === "reading-kanji"
    ? `[日本語で「${question.speakText}」と読んで]${written}`
    : promptMode === "japanese-written" ? `[日本語で]${written}`
    : promptMode === "written" ? written : question.speakText;
  const audio = await synthesize(prompt);
  fs.writeFileSync(path.join(outputDir, filename), audio);
  records.push({
    id: question.id,
    text: question.speakText,
    kanji: question.kanji || "",
    zh: question.zh || "",
    prompt,
    file: filename,
    bytes: audio.length,
  });
  process.stdout.write(`generated ${question.id} ${question.speakText} ${audio.length} bytes\n`);
  await new Promise((resolve) => setTimeout(resolve, 750));
}

const pack = {
  id: `fish-${referenceId.slice(0, 8)}-${category}-candidate`,
  provider: "Fish Audio",
  model,
  referenceId,
  category,
  promptMode,
  generatedAt: new Date().toISOString(),
  records,
};
fs.writeFileSync(path.join(outputDir, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
process.stdout.write(`done=${records.length} dir=${outputDir}\n`);
