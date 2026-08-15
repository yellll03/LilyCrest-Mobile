// Deployment-testing feature toggles.
//
// Survey/Feedback is functionally implemented (screens, drafts, notification
// routing) but not polished enough to expose to tenants yet. Nothing is
// deleted — every entry point below checks this flag so the feature can be
// re-enabled by flipping it back to true, with no further code changes.
export const SURVEY_FEEDBACK_ENABLED = false;
