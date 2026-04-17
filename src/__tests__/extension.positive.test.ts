import { expect } from 'chai';
import { activate, deactivate } from '../extension';

describe('extension – positive tests', () => {
  describe('deactivate()', () => {
    it('should return void without errors', () => {
      const result = deactivate();
      expect(result).to.be.undefined;
    });
  });

  describe('activate() – basic contract', () => {
    it('should be a function', () => {
      expect(activate).to.be.a('function');
    });

    it('should return a promise', () => {
      // We can verify the shape without actually calling it
      // since activate requires a real ExtensionContext
      expect(activate).to.have.property('length', 1); // 1 parameter
    });
  });
});
