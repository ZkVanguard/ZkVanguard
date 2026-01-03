/**
 * Test Configuration and Setup
 * Jest configuration for Sprint 2 tests
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@agents/(.*)$': '<rootDir>/agents/$1',
    '^@integrations/(.*)$': '<rootDir>/integrations/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@contracts/(.*)$': '<rootDir>/contracts/$1',
    '^@zk/(.*)$': '<rootDir>/zk/$1',
  },
  collectCoverageFrom: [
    'agents/**/*.ts',
    'integrations/**/*.ts',
    'zk/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  testTimeout: 30000,
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  globalTeardown: '<rootDir>/test/teardown-runner.js',
};
