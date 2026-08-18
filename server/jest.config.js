module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/setupTests.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  verbose: true,
  testTimeout: 10000,
  forceExit: true,
};