export const CURRENT_SCHEMA_VERSION = 1;

// Add future migrations here as functions keyed by the source schema version.
// A migration receives a deep-cloned package and must return schemaVersion + 1.
const MIGRATIONS = new Map();

export function migratePackage(input) {
  const pkg = structuredClone(input);
  let version = Number(pkg?.manifest?.schemaVersion || 0);
  if (!Number.isInteger(version) || version < 1) throw new Error('Conference package has an invalid schemaVersion');
  if (version > CURRENT_SCHEMA_VERSION) {
    const err = new Error(`Conference data schema ${version} is newer than this app supports (${CURRENT_SCHEMA_VERSION}).`);
    err.code = 'SCHEMA_TOO_NEW';
    throw err;
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new Error(`No migration path from conference schema ${version} to ${version + 1}`);
    const next = migrate(pkg);
    if (next && next !== pkg) Object.assign(pkg, next);
    version += 1;
    pkg.manifest.schemaVersion = version;
  }
  return pkg;
}
