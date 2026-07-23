'use strict';

const { getDb } = require('../config/database');
const { validateDefinition } = require('../domain/surveys/surveyValidation');
const { authorizedBranch } = require('../middleware/surveyAccess');
const { resolveEligibility } = require('../services/surveyEligibility.service');
const surveyService = require('../services/survey.service');
const { saveNotificationForUser } = require('../services/notificationService');

function safeError(res, error) {
  if (error?.status && error.status < 500) {
    return res.status(error.status).json({ detail: error.message, code: error.code, fields: error.fields });
  }
  console.error('Survey operation failed:', error);
  return res.status(500).json({ detail: 'Something went wrong while submitting your survey. Please try again later.' });
}

async function listMine(req, res) {
  try { return res.json({ surveys: await surveyService.listForTenant(getDb(), req.user) }); }
  catch (error) { return safeError(res, error); }
}

async function getMine(req, res) {
  try { return res.json(await surveyService.getForTenant(getDb(), req.user, req.params.surveyId)); }
  catch (error) { return safeError(res, error); }
}

async function saveMyDraft(req, res) {
  try { return res.json(await surveyService.saveDraft(getDb(), req.user, req.params.surveyId, req.body?.answers)); }
  catch (error) { return safeError(res, error); }
}

async function submitMine(req, res) {
  try { return res.status(201).json(await surveyService.submit(getDb(), req.user, req.params.surveyId, req.body?.answers)); }
  catch (error) { return safeError(res, error); }
}

async function getMyResponse(req, res) {
  try { return res.json(await surveyService.responseForTenant(getDb(), req.user, req.params.surveyId)); }
  catch (error) { return safeError(res, error); }
}

async function createSurvey(req, res) {
  try {
    const branch = authorizedBranch(req);
    const input = branch ? { ...req.body, branchId: branch } : req.body;
    return res.status(201).json(await surveyService.createDefinition(getDb(), input, req.user));
  }
  catch (error) { return safeError(res, error); }
}

async function updateSurvey(req, res) {
  try {
    const db = getDb();
    const branch = authorizedBranch(req);
    const current = await db.collection('survey_definitions').findOne({
      surveyId: req.params.surveyId,
      ...(branch ? { branchId: branch } : {}),
    });
    if (!current) return res.status(404).json({ detail: 'Survey not found.' });
    if (current.status !== 'DRAFT') return res.status(409).json({ detail: 'Only draft surveys can be edited.' });
    const value = validateDefinition(branch ? { ...req.body, branchId: branch } : req.body, current);
    await db.collection('survey_definitions').updateOne({ _id: current._id }, { $set: { ...value, updatedAt: new Date() } });
    return res.json({ ...current, ...value });
  } catch (error) { return safeError(res, error); }
}

async function activateSurvey(req, res) {
  try {
    const db = getDb();
    const branch = authorizedBranch(req);
    const survey = await db.collection('survey_definitions').findOne({
      surveyId: req.params.surveyId,
      ...(branch ? { branchId: branch } : {}),
    });
    if (!survey) return res.status(404).json({ detail: 'Survey not found.' });
    await db.collection('survey_definitions').updateOne({ _id: survey._id }, { $set: { status: 'ACTIVE', activatedAt: new Date(), updatedAt: new Date() } });
    const users = await db.collection('users').find({ role: { $nin: ['admin', 'superadmin', 'owner'] }, is_active: { $ne: false } }).toArray();
    for (const user of users) {
      const eligibility = await resolveEligibility(db, user, { ...survey, status: 'ACTIVE' });
      if (!eligibility.eligible) continue;
      await saveNotificationForUser(user.user_id, {
        title: survey.surveyType === 'MOVE_OUT' ? 'Move-out survey available' : 'Tenant survey available',
        body: survey.surveyType === 'MOVE_OUT' ? 'Your move-out feedback survey is now available.' : 'A new tenant satisfaction survey is available.',
        type: 'survey', category: 'Survey', url: `/surveys/${survey.surveyId}`,
        eventKey: `survey_available:${survey.surveyId}:${user.user_id}`,
        data: { surveyId: survey.surveyId },
      }, { db });
    }
    return res.json({ surveyId: survey.surveyId, status: 'ACTIVE' });
  } catch (error) { return safeError(res, error); }
}

async function closeSurvey(req, res) {
  try {
    const branch = authorizedBranch(req);
    const result = await getDb().collection('survey_definitions').findOneAndUpdate(
      { surveyId: req.params.surveyId, status: 'ACTIVE', ...(branch ? { branchId: branch } : {}) },
      { $set: { status: 'CLOSED', closedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ detail: 'Active survey not found.' });
    return res.json({ surveyId: result.surveyId, status: result.status });
  } catch (error) { return safeError(res, error); }
}

async function listAdmin(req, res) {
  try {
    const branch = authorizedBranch(req);
    const filter = branch ? { $or: [{ branchId: branch }, { branchId: null }] } : {};
    const surveys = await getDb().collection('survey_definitions').find(filter).sort({ createdAt: -1 }).toArray();
    return res.json({ surveys });
  } catch (error) { return safeError(res, error); }
}

async function results(req, res) {
  try {
    const db = getDb(); const branch = authorizedBranch(req);
    const survey = await db.collection('survey_definitions').findOne({ surveyId: req.params.surveyId });
    if (!survey || (branch && survey.branchId && String(survey.branchId) !== branch)) return res.status(404).json({ detail: 'Survey not found.' });
    const summary = await surveyService.analytics(db, survey, branch);
    const eligibleUsers = await db.collection('users').find({ role: { $nin: ['admin', 'superadmin', 'owner'] }, is_active: { $ne: false } }).toArray();
    let eligibleTenants = 0;
    for (const user of eligibleUsers) {
      const eligibility = await resolveEligibility(db, user, survey);
      if (eligibility.eligible && (!branch || eligibility.branchId === branch)) eligibleTenants += 1;
    }
    return res.json({
      surveyId: survey.surveyId, eligibleTenants, ...summary,
      pendingResponses: Math.max(eligibleTenants - summary.submittedResponses, 0),
      completionPercentage: eligibleTenants ? Number(((summary.submittedResponses / eligibleTenants) * 100).toFixed(1)) : 0,
    });
  } catch (error) { return safeError(res, error); }
}

async function responses(req, res) {
  try {
    const db = getDb(); const branch = authorizedBranch(req);
    const survey = await db.collection('survey_definitions').findOne({ surveyId: req.params.surveyId });
    if (!survey || (branch && survey.branchId && String(survey.branchId) !== branch)) return res.status(404).json({ detail: 'Survey not found.' });
    const filter = { surveyId: survey._id, status: 'SUBMITTED' };
    if (branch) filter.branchId = branch;
    const records = await db.collection('survey_responses').find(filter, {
      projection: { responseId: 1, branchId: 1, answers: 1, submittedAt: 1, status: 1 },
    }).sort({ submittedAt: -1 }).toArray();
    return res.json({ responses: records });
  } catch (error) { return safeError(res, error); }
}

async function approveSurveySkip(req, res) {
  try {
    const reason = String(req.body?.surveySkipReason || '').trim();
    if (!reason) return res.status(422).json({ detail: 'An authorized skip reason is required.' });
    const branch = authorizedBranch(req);
    const result = await getDb().collection('move_out_requests').findOneAndUpdate(
      {
        requestId: req.params.requestId,
        ...(branch ? { $or: [{ branchId: branch }, { branch_id: branch }, { branch: branch }] } : {}),
      },
      { $set: { surveySkipped: true, surveySkipReason: reason, surveySkipApprovedBy: req.user.user_id || req.user._id, surveySkipApprovedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ detail: 'Move-out request not found.' });
    return res.json({ requestId: result.requestId, surveySkipped: true });
  } catch (error) { return safeError(res, error); }
}

module.exports = {
  activateSurvey, approveSurveySkip, closeSurvey, createSurvey, getMine, getMyResponse,
  listAdmin, listMine, responses, results, saveMyDraft, submitMine, updateSurvey,
};
