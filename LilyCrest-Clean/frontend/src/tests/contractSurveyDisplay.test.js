/* global test, __dirname */
const fs = require('fs');
const path = require('path');

const contractSource = fs.readFileSync(path.resolve(__dirname, '../../app/contract-viewer.jsx'), 'utf8');
const profileSource = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/profile.jsx'), 'utf8');
const surveySource = fs.readFileSync(path.resolve(__dirname, '../../app/surveys.jsx'), 'utf8');

describe('contract and survey display source contracts', () => {
  test('Profile and Contract screen share the controlled mapper', () => {
    expect(contractSource).toContain('buildContractSummary');
    expect(profileSource).toContain('buildContractSummary');
    expect(contractSource).not.toContain('value(contract.status)');
    expect(profileSource).not.toContain("user.contract.status || 'Not available'");
  });

  test('contract PDF button is conditional and missing values use one message', () => {
    expect(contractSource).toContain('summary.canOpenPdf ?');
    expect(contractSource).toContain('Some contract details are still being finalized.');
    expect(contractSource).not.toContain("const value = (v) => v || 'Not available'");
  });

  test('survey error and empty states are mutually exclusive and error offers retry', () => {
    expect(surveySource).toContain(') : !surveys.length ? (');
    expect(surveySource).toContain('Unable to load surveys right now.');
    expect(surveySource).toContain('>Retry</Text>');
    expect(surveySource).not.toContain('safeSurveyErrorMessage');
    expect(surveySource).toContain('Estimated Time: 2–3 minutes');
    expect(profileSource).toContain('apiService.getMySurveys()');
    expect(profileSource).toContain("activeSurvey?.surveyType === 'QUARTERLY'");
  });
});
