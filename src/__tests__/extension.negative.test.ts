import { expect } from 'chai';
import { deactivate } from '../extension';

describe('extension – negative tests', () => {
  describe('deactivate() edge cases', () => {
    it('should be safe to call multiple times', () => {
      deactivate();
      deactivate();
      deactivate();
      // No throw
    });
  });
});
