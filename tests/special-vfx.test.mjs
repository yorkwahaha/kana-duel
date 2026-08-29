import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const heroes = ["ao", "gen", "go", "ran", "rin", "sho", "ya", "yo"];

test("all eight ultimates keep a cast video and a dedicated aftermath scene", () => {
  const vfx = read("game-vfx.js");
  const css = read("special-vfx.css");
  const html = read("index.html");

  for (const hero of heroes) {
    assert.ok(fs.existsSync(path.join(root, "assets", "anim", `${hero}-cast.mp4`)), `${hero}: missing cast video`);
    assert.match(vfx, new RegExp(`\\b${hero}: \\d{4}`), `${hero}: missing aftermath duration`);
    assert.match(css, new RegExp(`\\.ultimate-impact--${hero}\\b`), `${hero}: missing visual identity`);
  }

  assert.match(html, /special-vfx\.css\?v=20260829-skill-rebalance/);
  assert.match(vfx, /el\.replaceChildren\(buildSpecialAftermath\(resolvedTheme\)\)/);
  assert.match(vfx, /prefersReducedMotion\(\)[\s\S]*?await wait\(180\)/);
});

test("special attacks do not fall back to the basic bolt after their full-screen effect", () => {
  const local = read("game.js");
  const online = read("game-online.js");
  const localSpecialStart = local.indexOf("if (isSpecial) {");
  const localSpecialEnd = local.indexOf("} else {", localSpecialStart);
  const onlineSpecialStart = online.indexOf("if (event.special) {");
  const onlineSpecialEnd = online.indexOf("} else {", onlineSpecialStart);

  assert.match(local, /if \(!isSpecial\) \{\s*playAttackBolt\(player, foe, atkTheme/);
  assert.doesNotMatch(local, /大招開場連射兩道/);
  assert.doesNotMatch(local.slice(localSpecialStart, localSpecialEnd), /playAttackBolt/);
  assert.match(online, /if \(!event\.special\) \{\s*playAttackBolt\(player, foe, theme/);
  assert.doesNotMatch(online.slice(onlineSpecialStart, onlineSpecialEnd), /playAttackBolt/);
});
