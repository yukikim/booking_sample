import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BRACES_ADVISORY, BRACES_EXCEPTION_EXPIRES_AT, evaluateAudit } from "./lib/dependency-audit.mjs";

try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", "--audit-level=high"], {
      cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
    });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error || result.signal || ![0, 1].includes(result.status ?? -1)) {
    throw new Error(`npm auditを正常に実行できませんでした: ${result.error?.message ?? result.signal ?? result.status}`);
  }
  const report = JSON.parse(result.stdout);
  const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const { blocked, excepted } = evaluateAudit(report, lockfile);
  if (excepted.length) {
    console.warn(`\nWARNING: 未修正の開発依存 ${BRACES_ADVISORY} を期限付きで許容しています。`);
    console.warn(`期限: ${BRACES_EXCEPTION_EXPIRES_AT} 未満 / 波及するパッケージ: ${excepted.join(", ")}`);
    console.warn("脆弱性は解消していません。修正版が公開されたら更新し、例外を削除してください。");
  }
  if (blocked.length) {
    throw new Error(`許容対象外または期限切れのhigh以上の脆弱性: ${blocked.join(", ")}`);
  }
  // 不明な終了コード1の原因を例外で隠さない。
  if (result.status === 1 && excepted.length === 0) {
    throw new Error("npm auditが失敗しましたが、許容できる脆弱性がありません。");
  }
  console.log("\n依存監査の合否判定: PASS（期限付き例外がある場合は上記警告を参照）");
} catch (error) {
  console.error(`\n依存監査: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
