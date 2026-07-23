'use strict';

const router = require('express').Router();
const controller = require('../controllers/survey.controller');
const { authMiddleware } = require('../middleware/auth');
const { surveyAdminMiddleware } = require('../middleware/surveyAccess');

router.use(authMiddleware);
router.get('/me', controller.listMine);
router.get('/:surveyId/me', controller.getMine);
router.put('/:surveyId/draft', controller.saveMyDraft);
router.post('/:surveyId/submit', controller.submitMine);
router.get('/:surveyId/response/me', controller.getMyResponse);

router.post('/admin/manage', surveyAdminMiddleware, controller.createSurvey);
router.get('/admin/manage', surveyAdminMiddleware, controller.listAdmin);
router.put('/admin/manage/:surveyId', surveyAdminMiddleware, controller.updateSurvey);
router.post('/admin/manage/:surveyId/activate', surveyAdminMiddleware, controller.activateSurvey);
router.post('/admin/manage/:surveyId/close', surveyAdminMiddleware, controller.closeSurvey);
router.get('/admin/manage/:surveyId/results', surveyAdminMiddleware, controller.results);
router.get('/admin/manage/:surveyId/responses', surveyAdminMiddleware, controller.responses);
router.post('/admin/move-out/:requestId/survey-skip', surveyAdminMiddleware, controller.approveSurveySkip);

module.exports = router;
