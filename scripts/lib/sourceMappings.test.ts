import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { detectFormat, parseImportFile } from "./sourceMappings.js";

test("parses the shared template.csv", () => {
  const content = readFileSync(join(import.meta.dirname, "..", "..", "imports", "template.csv"), "utf-8");
  const rows = parseImportFile(content);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "trustpilot");
  assert.equal(rows[0].rating, 5);
  assert.equal(rows[0].reviewDate, "2026-08-14");
  assert.equal(rows[0].reviewerName, "Sarah M.");
  assert.ok(rows[0].dedupeHash.length === 64);
  assert.equal(rows[1].source, "google");
  assert.equal(rows[1].reviewUrl, null);
});

test("rejects an unrecognized source in the template", () => {
  const csv = "source,rating,review_date,reviewer_name,review_text,review_url\nyelp,4,2026-01-01,A,Good,\n";
  assert.throws(() => parseImportFile(csv), /Unknown source/);
});

test("detects a Feefo-shaped export via header candidates", () => {
  const headers = ["Reference", "Service Rating", "Date Created", "Customer Name", "Comments"];
  assert.equal(detectFormat(headers), "feefo");
});

test("parses a Feefo-shaped CSV end to end", () => {
  const csv =
    "Reference,Service Rating,Date Created,Customer Name,Comments\n" +
    'FB-123,5,2026-08-01,Jane D.,"Brilliant trip, cabin crew were fantastic"\n';
  const rows = parseImportFile(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "feefo");
  assert.equal(rows[0].externalId, "FB-123");
  assert.equal(rows[0].rating, 5);
  assert.equal(rows[0].reviewDate, "2026-08-01");
  assert.equal(rows[0].reviewerName, "Jane D.");
});

test("throws a clear error for an unrecognized CSV shape", () => {
  const csv = "foo,bar\n1,2\n";
  assert.throws(() => parseImportFile(csv), /Could not recognize CSV format/);
});

test("dedupe hash is stable for identical content and differs for different content", () => {
  const csv =
    "source,rating,review_date,reviewer_name,review_text,review_url\n" +
    "trustpilot,4,2026-01-01,A,Same text here,\n" +
    "trustpilot,4,2026-01-01,B,Same text here,\n" +
    "trustpilot,3,2026-01-01,A,Same text here,\n";
  const rows = parseImportFile(csv);
  assert.equal(rows[0].dedupeHash, rows[1].dedupeHash, "reviewer name doesn't affect the hash");
  assert.notEqual(rows[0].dedupeHash, rows[2].dedupeHash, "rating does affect the hash");
});
