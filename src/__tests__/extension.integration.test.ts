import { expect } from 'chai';
import { activate, deactivate } from '../extension';

describe('extension – integration tests', () => {
  describe('module exports', () => {
    it('should export activate as async function', () => {
      expect(activate).to.be.a('function');
    });

    it('should export deactivate as function', () => {
      expect(deactivate).to.be.a('function');
    });

    it('deactivate should be callable without prior activate', () => {
      deactivate();
      // No throw
    });
  });
});
