/* global test */
import {
  NEW_PASSWORD_MAX_LENGTH,
  blockPasswordWhitespaceInput,
  getStrongPasswordChecks,
  validateLoginPassword,
  validateStrongPassword,
} from '../utils/passwordValidation';

describe('mobile password contract', () => {
  test.each([
    ['empty', '', false],
    ['seven characters', 'Aa1!aaa', false],
    ['valid exactly eight', 'Aa1!aaaa', true],
    ['missing uppercase', 'aa1!aaaa', false],
    ['missing lowercase', 'AA1!AAAA', false],
    ['missing number', 'Aaa!aaaa', false],
    ['missing special', 'Aaa1aaaa', false],
    ['middle whitespace', 'Aa1! aaab', false],
    ['leading whitespace', ' Aa1!aaab', false],
    ['trailing whitespace', 'Aa1!aaab ', false],
    ['tab', 'Aa1!\taaab', false],
    ['newline', 'Aa1!\naaab', false],
    ['strong valid', 'Lilycrest2026#Secure', true],
    ['maximum boundary', `Aa1!${'x'.repeat(NEW_PASSWORD_MAX_LENGTH - 4)}`, true],
    ['over maximum', `Aa1!${'x'.repeat(NEW_PASSWORD_MAX_LENGTH - 3)}`, false],
  ])('%s', (_label, password, valid) => {
    expect(validateStrongPassword(password).valid).toBe(valid);
  });

  test('special means any non-alphanumeric, non-whitespace character', () => {
    expect(getStrongPasswordChecks('ValidPass1©').special).toBe(true);
  });

  test.each([' Leading1!', 'Trailing1! ', 'Middle Space1!', 'Tab\tValue1!', 'Line\nValue1!'])(
    'login rejects whitespace credential %p',
    (password) => {
      expect(validateLoginPassword(password)).toEqual({
        valid: false,
        error: 'Password must not contain whitespace.',
      });
    },
  );

  test('pasted whitespace is blocked as one atomic edit instead of silently stripping characters', () => {
    expect(blockPasswordWhitespaceInput('Valid1! pasted', 'Valid1!')).toEqual({
      value: 'Valid1!',
      blocked: true,
    });
  });
});
