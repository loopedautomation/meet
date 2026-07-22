/**
 * Browsers decorate device names with parenthesized noise — vendor:product
 * ids like "(05ac:8514)", "(Built-in)", "(Virtual)". Strip every bracketed
 * chunk and tidy the spacing: "FaceTime HD Camera (Built-in) (05ac:8600)"
 * -> "FaceTime HD Camera". Two identical devices may end up with the same
 * cleaned name; the selects still key on deviceId, so selection stays exact.
 */
export function cleanDeviceLabel(label: string): string {
  const cleaned = label
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  return cleaned || label
}
