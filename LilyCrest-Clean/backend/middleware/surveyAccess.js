'use strict';

function permissions(user = {}) {
  return new Set([...(user.permissions || []), ...(user.permissionKeys || [])].map((value) => String(value).toLowerCase()));
}

function surveyAdminMiddleware(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const allowed = ['owner', 'superadmin'].includes(role)
    || (role === 'admin' && (permissions(req.user).has('survey_manage') || permissions(req.user).has('survey_management')));
  if (!allowed) return res.status(403).json({ detail: 'Survey management permission required.' });
  return next();
}

function authorizedBranch(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (['owner', 'superadmin'].includes(role)) return null;
  return String(req.user?.branchId || req.user?.branch_id || req.user?.branch || '');
}

module.exports = { authorizedBranch, surveyAdminMiddleware };
