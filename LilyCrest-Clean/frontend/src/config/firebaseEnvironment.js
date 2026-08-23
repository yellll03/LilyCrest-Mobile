const NON_PRODUCTION_MARKER = /(?:^|[-_.])(staging|stage|qa|e2e|test|dev)(?:$|[-_.])/i;

export function validateFirebaseEnvironment({
  environment,
  projectId,
  storageBucket,
  appId,
}) {
  const target = String(environment || '').trim().toLowerCase();
  const project = String(projectId || '').trim();
  const bucket = String(storageBucket || '').trim();
  const application = String(appId || '').trim();
  const failures = [];

  if (target === 'staging') {
    if (!project || !NON_PRODUCTION_MARKER.test(project)) failures.push('Firebase project must be explicitly staging/QA');
    if (!bucket || !NON_PRODUCTION_MARKER.test(bucket)) failures.push('Firebase storage bucket must be explicitly staging/QA');
    if (!application) failures.push('Firebase app id is required');
  } else if (target === 'production') {
    if (NON_PRODUCTION_MARKER.test(project)) failures.push('production build contains a staging/QA Firebase project');
    if (NON_PRODUCTION_MARKER.test(bucket)) failures.push('production build contains a staging/QA Firebase bucket');
  }

  if (failures.length) {
    throw new Error(`Firebase environment isolation failed: ${failures.join('; ')}`);
  }
  return true;
}
