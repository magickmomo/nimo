import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("public journal uses chronological index without changing visibility filters", () => {
  const publicEvents = source.slice(source.indexOf("async function publicEvents("), source.indexOf("/** On-demand journal pagination."));
  assert.match(publicEvents, /FROM events INDEXED BY events_latest/);
  assert.match(publicEvents, /ORDER BY id DESC LIMIT \?/);
  assert.match(publicEvents, /kind='world' AND action='ORACLE_WHISPER'/);
  assert.match(publicEvents, /action IS NULL OR action <> 'REQUEST'/);
  assert.doesNotMatch(publicEvents, /kind IN \('visitor','reply'\)/);
});

test("paginated journal keeps filters, date anchors and id cursor while using chronological index", () => {
  const page = source.slice(source.indexOf("async function journalPage("), source.indexOf("// Owner-only historical export."));
  assert.match(page, /FROM events INDEXED BY events_latest/);
  assert.match(page, /created_at <= \?/);
  assert.match(page, /created_at >= \?/);
  assert.match(page, /id < \?/);
  assert.match(page, /ORDER BY id DESC LIMIT \?/);
  assert.match(page, /hasMore:rows\.results\.length>limit/);
  assert.match(page, /nextCursor:entries\.length\?entries\[entries\.length-1\]\.id:null/);
});
