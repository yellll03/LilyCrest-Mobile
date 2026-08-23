const { assertStagingWriteTarget } = require('./scripts/stagingWriteGuard');
assertStagingWriteTarget(process.env, { toolName: 'migration_script_fixed.js' });

// Deprecated script shim: keep this filename for compatibility.
console.warn('[deprecated] Use `npm run maintenance:migrate-to-primary -- --apply` after reviewing the dry-run output.');
require('./scripts/migrateMaintenanceToPrimary');
