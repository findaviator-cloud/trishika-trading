export function manifestRoute(artifacts, inventory) {
  return {
    generatedAtUtc: artifacts.manifest.generatedAtUtc ?? null,
    purpose: artifacts.manifest.purpose ?? null,
    safety: artifacts.manifest.safety,
    officialDailyReference: artifacts.manifest.officialDailyReference,
    thirdPartyMinuteFixture: artifacts.manifest.thirdPartyMinuteFixture,
    sourceSeparation: artifacts.manifest.sourceSeparation,
    artifactInventory: inventory
  };
}
