'use strict';

const { resolveEligibility } = require('./surveyEligibility.service');
const { saveNotificationForUser } = require('./notificationService');

async function sendDueSoonReminders(db, now = new Date()) {
  const deadline = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
  const surveys = await db.collection('survey_definitions').find({
    status: 'ACTIVE', availableUntil: { $gte: now, $lte: deadline },
  }).toArray();
  if (!surveys.length) return 0;
  const users = await db.collection('users').find({
    role: { $nin: ['admin', 'superadmin', 'owner'] }, is_active: { $ne: false },
  }).toArray();
  let created = 0;
  for (const survey of surveys) {
    for (const user of users) {
      const eligibility = await resolveEligibility(db, user, survey);
      if (!eligibility.eligible) continue;
      const submitted = await db.collection('survey_responses').findOne({
        surveyId: survey._id, tenantId: String(eligibility.tenantId), status: 'SUBMITTED',
      });
      if (submitted) continue;
      await saveNotificationForUser(user.user_id, {
        title: 'Survey due soon',
        body: 'Your survey is due soon.',
        type: 'survey', category: 'Survey', url: `/surveys/${survey.surveyId}`,
        eventKey: `survey_due:${survey.surveyId}:${user.user_id}`,
        data: { surveyId: survey.surveyId },
      }, { db });
      created += 1;
    }
  }
  return created;
}

module.exports = { sendDueSoonReminders };
