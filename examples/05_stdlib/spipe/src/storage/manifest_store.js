// Compatibility-named facade for the immutable snapshot manifest store.  The
// implementation remains in snapshot_store.js so there is one identity and
// serialization contract rather than two competing manifest formats.
export {
  ImmutableSnapshotStore,
  ImmutableSnapshotStore as SnapshotManifestStore,
  SNAPSHOT_ID_PREFIX,
  SNAPSHOT_SCHEMA_VERSION,
  canonicalSnapshotTuple,
  computeSnapshotId,
  createSnapshotMetadata,
  createSnapshotStore,
  snapshotIdFor
} from "./snapshot_store.js";
