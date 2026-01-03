// test/teardown-runner.js
const tsNode = require('ts-node');
const tsConfigPaths = require('tsconfig-paths');
const tsConfig = require('../tsconfig.json');

// Register tsconfig-paths
const baseUrl = './'; // Or from tsconfig.json
tsConfigPaths.register({
  baseUrl,
  paths: tsConfig.compilerOptions.paths,
});

// Register ts-node
tsNode.register({
  transpileOnly: true,
  // Pass the compiler options from your tsconfig.json
  // to avoid conflicts.
  compilerOptions: {
    ...tsConfig.compilerOptions,
    module: 'commonjs', // Override module to commonjs for node execution
    moduleResolution: 'node', // Override moduleResolution for node
  },
});

// Now, require the teardown script and export its default function
module.exports = require('./teardown.ts').default;
