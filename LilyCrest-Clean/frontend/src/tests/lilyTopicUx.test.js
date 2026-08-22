/* global __dirname, test */
import fs from 'node:fs';
import path from 'node:path';
import { getLilyTopicSuggestions, LILY_TOPICS } from '../utils/lilyTopicSuggestions';

const source = fs.readFileSync(
  path.resolve(__dirname, '../screens/LilyAssistantScreen.jsx'),
  'utf8',
);

describe('Lily topic selection UX', () => {
  test('the welcome card is the only category navigation layer', () => {
    expect(LILY_TOPICS.map((topic) => topic.label)).toEqual([
      'Billing',
      'Maintenance',
      'Documents',
      'House Rules',
      'Account & Support',
    ]);
    expect(source).toContain('LILY_TOPICS.map');
    expect(source).not.toContain('QUICK_ACTIONS');
    expect(source).not.toContain('styles.quickActions');
    expect(source).not.toContain('handleQuickAction');
  });

  test.each([
    ['billing', 'When is my due date?'],
    ['maintenance', 'My previous concern still persists.'],
    ['documents', 'What is my current contract status?'],
    ['house-rules', 'What are the current house rules?'],
    ['account', 'Check my existing inquiries.'],
  ])('%s selects contextual questions', (topic, expectedQuestion) => {
    expect(getLilyTopicSuggestions(topic)).toContain(expectedQuestion);
  });

  test('topic selection updates suggestions without sending a duplicate category prompt', () => {
    expect(source).toContain('onPress={() => setSelectedTopic(topic.id)}');
    expect(source).toContain('getLilyTopicSuggestions(selectedTopic, suggestionContext)');
    expect(source).not.toMatch(/onPress=\{\(\) => handleSend\(topic\.prompt\)\}/);
  });

  test('resident and pre-move-in document suggestions are different', () => {
    const resident = getLilyTopicSuggestions('documents', { tenantState: 'resident' });
    const preMoveIn = getLilyTopicSuggestions('documents', { tenantState: 'pre_move_in' });

    expect(resident).toContain('What documents are available to me?');
    expect(resident.join(' ')).not.toMatch(/still required|move-in date/i);
    expect(preMoveIn).toContain('What documents are still required?');
    expect(preMoveIn).toContain('What move-in date is on my account?');
  });

  test('unresolved fallback never assumes the tenant still needs onboarding', () => {
    const suggestions = getLilyTopicSuggestions(null);
    expect(suggestions.join(' ')).not.toMatch(/move-in requirements|move-in date|still required/i);
    expect(source).toContain('apiService.getChatbotSuggestions()');
  });
});
