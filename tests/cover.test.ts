import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { getCover, updateCover } from "../app/lib/cover.server";

function form(intent: string, values: Record<string, string | File> = {}) {
  const f = new FormData(); f.set("intent", intent);
  for (const [key,value] of Object.entries(values)) f.set(key,value);
  return f;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=", "base64");
test("cover upload, positioning, replacement and removal persist", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync("migrations/0006_workspace_cover.sql", "utf8"));
    assert.equal(getCover(db), undefined);
    await updateCover(db, form("upload_cover", {cover: new File([png], "cover.png")}));
    const first = getCover(db)!;
    assert.equal(first.position,50);
    assert.deepEqual((db.prepare("SELECT image FROM workspace_cover").get() as {image:Buffer}).image,png);
    await updateCover(db, form("position_cover", {position:"72",version:first.version}));
    assert.equal(getCover(db)?.position,72);
    await assert.rejects(updateCover(db, form("position_cover", {position:"101",version:first.version})));
    await assert.rejects(updateCover(db, form("position_cover", {position:"20",version:"stale"})));
    await updateCover(db, form("upload_cover", {cover:new File([png],"replacement.png")}));
    assert.notEqual(getCover(db)?.version,first.version);
    assert.equal(getCover(db)?.position,50);
    await updateCover(db,form("remove_cover"));
    assert.equal(getCover(db),undefined);
  } finally { db.close(); }
});
test("invalid and oversized uploads leave the existing cover intact", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync("migrations/0006_workspace_cover.sql","utf8"));
    await updateCover(db,form("upload_cover",{cover:new File([png],"cover.png")}));
    const before=getCover(db);
    for(const f of [form("upload_cover"),form("upload_cover",{cover:new File(["<svg/>"],"fake.png",{type:"image/png"})}),form("upload_cover",{cover:new File([new Uint8Array(5*1024*1024+1)],"large.png")})])
      await assert.rejects(updateCover(db,f));
    assert.deepEqual(getCover(db),before);
  } finally {db.close();}
});
