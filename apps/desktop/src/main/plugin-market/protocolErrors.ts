import { GHOST_MANIFEST_SCHEMA_VERSION, GHOST_SLOTS } from '@cindy/plugin-protocol';

const CURRENT_RELEASE_MANIFEST_MARKER = 'currentRelease.manifest';
const MANIFEST_SCHEMA_REASON_PREFIX = `schemaVersion 必须是 ${GHOST_MANIFEST_SCHEMA_VERSION},得到 `;
const UNKNOWN_SLOT_REASON_PREFIX = 'slots 含未知卡槽 ';
// 与 plugin-protocol 的诊断构造同源(manifest.ts):`slots 含未知卡槽
// <JSON.stringify(slot)>(可用:<GHOST_SLOTS join ' / ')`。后缀必须锚定到诊断
// 末尾,不能用 indexOf——合法未知 slot 名本身可能包含 "(可用:" 文本,从 slot 名
// 内部任意位置反解析会切坏 JSON、把该升级的包误判为包无效。
const UNKNOWN_SLOT_REASON_SUFFIX = `(可用:${GHOST_SLOTS.join(' / ')})`;

function currentReleaseManifestReason(error: unknown): string | null {
  if (
    !(error instanceof Error) ||
    error.name !== 'PluginProtocolError' ||
    !error.message.includes(CURRENT_RELEASE_MANIFEST_MARKER)
  ) {
    return null;
  }

  const marker = ' 不合法: ';
  const markerIndex = error.message.indexOf(marker);
  if (markerIndex < 0) return null;
  return error.message.slice(markerIndex + marker.length);
}

function parseJsonLiteral(serialized: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(serialized) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * The market protocol validates the current release manifest while parsing a
 * detail response. Keep this narrow: only a genuine manifest parse/validation
 * failure (the ` 不合法: ` marker emitted by the protocol parser) maps to
 * `GHOST_FILE_INVALID`. Other protocol errors whose message merely mentions
 * `currentRelease.manifest` — e.g. oidc-token scope mismatch, name/description/
 * author consistency checks, or a missing manifest field — are envelope-level
 * failures and must stay INTERNAL so we don't mislabel a malformed server
 * response as a bad package. Malformed envelopes remain an internal/network
 * failure, while an unsupported manifest gets actionable UI.
 */
export function isPluginManifestIncompatibilityError(error: unknown): boolean {
  // Require the exact `currentRelease.manifest 不合法: <reason>` shape produced
  // by the protocol validator, not any message that happens to mention the
  // path. `currentReleaseManifestReason` returns null for non-parse errors.
  return currentReleaseManifestReason(error) !== null && !isPluginHostUnsupportedError(error);
}

/**
 * A valid future manifest must remain distinguishable from a malformed one.
 * The protocol validator deliberately reports these two compatibility signals
 * in the manifest reason so the desktop can give upgrade guidance.
 */
export function isPluginHostUnsupportedError(error: unknown): boolean {
  const reason = currentReleaseManifestReason(error);
  if (reason === null) return false;

  if (reason.startsWith(MANIFEST_SCHEMA_REASON_PREFIX)) {
    const serialized = reason.slice(MANIFEST_SCHEMA_REASON_PREFIX.length).split('(', 1)[0];
    const parsed = parseJsonLiteral(serialized);
    return (
      parsed.ok &&
      typeof parsed.value === 'number' &&
      Number.isSafeInteger(parsed.value) &&
      parsed.value > GHOST_MANIFEST_SCHEMA_VERSION
    );
  }

  if (!reason.startsWith(UNKNOWN_SLOT_REASON_PREFIX)) return false;
  // 后缀必须紧贴诊断末尾;长度不匹配说明不是这条已知形状(可能是其它清单错误,
  // 也可能是用户可控 slot 名里碰巧含 "(可用:" 文本),交给包无效分支。
  if (!reason.endsWith(UNKNOWN_SLOT_REASON_SUFFIX)) return false;
  const serialized = reason.slice(
    UNKNOWN_SLOT_REASON_PREFIX.length,
    reason.length - UNKNOWN_SLOT_REASON_SUFFIX.length,
  );
  const parsed = parseJsonLiteral(serialized);
  return parsed.ok && typeof parsed.value === 'string';
}
