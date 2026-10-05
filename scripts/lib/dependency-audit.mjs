export const BRACES_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
// 2026-10-19 23:59:59.999 JSTまで。環境変数・CLIでの延長は許可しない。
export const BRACES_EXCEPTION_EXPIRES_AT = "2026-10-20T00:00:00+09:00";

/**
 * @typedef {{name: string, severity: string, nodes: string[], via: (string | {name: string, url: string, severity: string})[]}} Vulnerability
 * @param {{auditReportVersion: number, error?: unknown, vulnerabilities: Record<string, Vulnerability>}} report
 * @param {{packages: Record<string, {dev?: boolean, version?: string}>}} lockfile
 * @param {Date} now
 */
export function evaluateAudit(report, lockfile, now = new Date()) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities) ||
      !lockfile?.packages || !Number.isFinite(now.getTime())) {
    throw new Error("監査結果またはlockfileの形式が不正です。");
  }
  const entries = Object.entries(report.vulnerabilities);
  const severities = ["info", "low", "moderate", "high", "critical"];
  for (const [name, item] of entries) {
    if (!item || item.name !== name || !severities.includes(item.severity) ||
        !Array.isArray(item.nodes) || item.nodes.length === 0 ||
        item.nodes.some((path) => typeof path !== "string" || !lockfile.packages[path]) ||
        !Array.isArray(item.via) || item.via.length === 0 ||
        item.via.some((via) => typeof via === "string"
          ? !report.vulnerabilities[via]
          : !via || typeof via.url !== "string" || typeof via.name !== "string" || !severities.includes(via.severity))) {
      throw new Error(`監査結果の項目が不正です: ${name}`);
    }
  }

  /** @param {string} name @param {Set<string>} visiting @returns {boolean} */
  function isTemporaryException(name, visiting = new Set()) {
    const item = report.vulnerabilities[name];
    if (!item || visiting.has(name) || item.severity !== "high" ||
        now.getTime() >= Date.parse(BRACES_EXCEPTION_EXPIRES_AT) ||
        item.nodes.some((path) => lockfile.packages[path].dev !== true)) return false;
    const next = new Set(visiting).add(name);
    return item.via.every((via) => {
      if (typeof via === "string") return isTemporaryException(via, next);
      return name === "braces" && via.name === "braces" && via.url === BRACES_ADVISORY &&
        via.severity === "high" && item.nodes.every((path) => lockfile.packages[path].version === "3.0.3");
    });
  }

  const high = entries.filter(([, item]) => ["high", "critical"].includes(item.severity));
  return {
    blocked: high.filter(([name]) => !isTemporaryException(name)).map(([name]) => name),
    excepted: high.filter(([name]) => isTemporaryException(name)).map(([name]) => name),
  };
}
