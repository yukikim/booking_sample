import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { BRACES_ADVISORY, evaluateAudit } from "../scripts/lib/dependency-audit.mjs";

function fixture() {
  return {
    report: {
      auditReportVersion: 2,
      vulnerabilities: {
        braces: { name: "braces", severity: "high", nodes: ["node_modules/braces"],
          via: [{ name: "braces", severity: "high", url: BRACES_ADVISORY }] },
        micromatch: { name: "micromatch", severity: "high", nodes: ["node_modules/micromatch"], via: ["braces"] },
      },
    },
    lock: { packages: {
      "node_modules/braces": { dev: true, version: "3.0.3" },
      "node_modules/micromatch": { dev: true, version: "4.0.8" },
    } },
  };
}
const beforeExpiry = new Date("2026-10-19T23:59:59.999+09:00");

test("既知の開発依存とその波及だけをJST期限直前まで許容する", () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, beforeExpiry), { blocked: [], excepted: ["braces", "micromatch"] });
  assert.deepEqual(evaluateAudit(report, lock, new Date("2026-10-20T00:00:00+09:00")).blocked, ["braces", "micromatch"]);
});

test("別の脆弱性が同じパッケージに追加されたら波及先も失敗する", () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: "braces", severity: "high", url: "https://github.com/advisories/GHSA-other" });
  assert.deepEqual(evaluateAudit(report, lock, beforeExpiry).blocked, ["braces", "micromatch"]);
});

test("本番依存への移動・許容バージョン変更・critical昇格は失敗する", () => {
  for (const change of ["production", "version", "critical"]) {
    const { report, lock } = fixture();
    if (change === "production") lock.packages["node_modules/braces"].dev = false;
    if (change === "version") lock.packages["node_modules/braces"].version = "3.0.4";
    if (change === "critical") report.vulnerabilities.braces.severity = "critical";
    assert.deepEqual(evaluateAudit(report, lock, beforeExpiry).blocked, ["braces", "micromatch"]);
  }
});

test("別パッケージのhighは既知の例外と同時に出ても失敗する", () => {
  const { report, lock } = fixture();
  const other = { name: "other", severity: "high", nodes: ["node_modules/other"],
    via: [{ name: "other", severity: "high", url: "https://github.com/advisories/GHSA-other" }] };
  const result = evaluateAudit({ ...report, vulnerabilities: { ...report.vulnerabilities, other } },
    { packages: { ...lock.packages, "node_modules/other": { dev: true, version: "1.0.0" } } }, beforeExpiry);
  assert.deepEqual(result.blocked, ["other"]);
});

test("波及先が本番依存ならそのパッケージは例外に含めない", () => {
  const { report, lock } = fixture();
  lock.packages["node_modules/micromatch"].dev = false;
  assert.deepEqual(evaluateAudit(report, lock, beforeExpiry).blocked, ["micromatch"]);
});

test("監査APIエラー・不正形式・欠落した依存経路は失敗する", () => {
  const { report, lock } = fixture();
  assert.throws(() => evaluateAudit({ ...report, error: { code: "ENOAUDIT" } }, lock, beforeExpiry));
  assert.throws(() => evaluateAudit({ ...report, auditReportVersion: 99 }, lock, beforeExpiry));
  report.vulnerabilities.micromatch.via = ["missing"];
  assert.throws(() => evaluateAudit(report, lock, beforeExpiry));
});

test("循環経路は例外扱いせず、脆弱性0件なら期限後も成功する", () => {
  const { report, lock } = fixture();
  report.vulnerabilities.micromatch.via = ["micromatch"];
  assert.deepEqual(evaluateAudit(report, lock, beforeExpiry).blocked, ["micromatch"]);
  assert.deepEqual(evaluateAudit({ auditReportVersion: 2, vulnerabilities: {} }, lock,
    new Date("2026-10-21T00:00:00+09:00")), { blocked: [], excepted: [] });
});

test("監査CLIは通信エラー・不正JSON・不明な終了コードを失敗として返す", () => {
  const dir = mkdtempSync(join(tmpdir(), "booking-audit-test-"));
  try {
    // npmの応答だけを差し替え、実際の監査CLIを子プロセスで検証する。
    const scenarios = [
      { output: JSON.stringify({ error: { code: "ENOTFOUND" } }), status: 1, expected: 1 },
      { output: "invalid JSON", status: 0, expected: 1 },
      { output: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), status: 2, expected: 1 },
      { output: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), status: 1, expected: 1 },
      { output: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), status: 0, expected: 0 },
    ];
    for (const scenario of scenarios) {
      writeFileSync(join(dir, "npm"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(scenario.output)});\nprocess.exitCode = ${scenario.status};\n`, { mode: 0o755 });
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/audit-dependencies.mjs", import.meta.url))], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` }, encoding: "utf8", timeout: 10_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, scenario.expected, result.stderr);
      assert.match(result.stdout + result.stderr, scenario.expected ? /FAIL/ : /PASS/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
