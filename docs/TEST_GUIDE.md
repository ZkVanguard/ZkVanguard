# Sprint 2 Test Execution Guide

## Quick Start

### Run All Tests
```bash
npm run test:sprint2
```

### Run with Coverage
```bash
npm run test:sprint2 -- --coverage
```

### Run in Watch Mode
```bash
npm run test:sprint2 -- --watch
```

## Individual Test Suites

### Agent Tests
```bash
# HedgingAgent
npm test -- test/agents/HedgingAgent.test.ts

# SettlementAgent
npm test -- test/agents/SettlementAgent.test.ts

# ReportingAgent
npm test -- test/agents/ReportingAgent.test.ts
```

### Integration Tests
```bash
# E2E Workflow
npm test -- test/integration/e2e-workflow.test.ts

# ZK-STARK Integration
npm test -- test/integration/zk-stark.test.ts
```

## Test Options

### Verbose Output
```bash
npm run test:debug
```

### Coverage Report
```bash
npm run test:coverage
```

### CI Mode
```bash
npm run test:ci
```

## Test Structure

```
test/
├── agents/                      # Agent unit tests
│   ├── HedgingAgent.test.ts    # 35+ tests
│   ├── SettlementAgent.test.ts # 40+ tests
│   └── ReportingAgent.test.ts  # 30+ tests
├── integration/                 # Integration tests
│   ├── e2e-workflow.test.ts    # 15+ scenarios
│   └── zk-stark.test.ts        # ZK proof tests
├── setup.ts                     # Global test setup
└── jest.config.js               # Jest configuration
```

## Expected Results

### Success Criteria
- ✅ All 120+ tests pass
- ✅ Coverage > 70% (branches, functions, lines, statements)
- ✅ No memory leaks
- ✅ Response times < 5 seconds per test
- ✅ No console errors

### Test Metrics
- **Total Tests**: 120+
- **Test Suites**: 5
- **Average Duration**: ~30-60 seconds
- **Coverage Target**: 70%+

## Troubleshooting

### Tests Fail Due to Missing Dependencies
```bash
npm install
```

### TypeScript Compilation Errors
```bash
npm run typecheck
```

### Mock Issues
Check `test/setup.ts` for mock configurations.

### Timeout Errors
Increase timeout in `jest.config.js`:
```javascript
testTimeout: 60000 // 60 seconds
```

### Port Already in Use
Stop any running instances:
```bash
# Windows
netstat -ano | findstr :8545
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:8545 | xargs kill -9
```

## Coverage Reports

After running tests with coverage, view the report:

### Terminal Summary
Displayed automatically after test run.

### HTML Report
```bash
# Generate and open
npm run test:coverage
# Then open coverage/lcov-report/index.html
```

### Coverage Breakdown
- **Agents**: 80%+ expected
- **Integrations**: 70%+ expected
- **Shared Utilities**: 75%+ expected

## Debugging Tests

### Debug Specific Test
```bash
node --inspect-brk node_modules/.bin/jest test/agents/HedgingAgent.test.ts
```

### VS Code Debug Configuration
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "${file}"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## CI/CD Integration

### GitHub Actions
```yaml
name: Sprint 2 Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:ci
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

## Performance Benchmarks

### Expected Test Times
- **HedgingAgent**: ~5-10 seconds
- **SettlementAgent**: ~8-12 seconds
- **ReportingAgent**: ~5-8 seconds
- **E2E Integration**: ~15-20 seconds
- **Total Suite**: ~30-60 seconds

### Optimization Tips
1. Run tests in parallel: `--maxWorkers=4`
2. Use test.only for focused testing during development
3. Mock expensive operations
4. Use beforeAll for shared setup

## Test Data

### Mock Data Location
- Global mocks: `test/setup.ts`
- Agent-specific: Inline in test files
- Integration: `test/fixtures/` (if created)

### Generating Test Data
```typescript
import { testUtils } from '../setup';

// Random address
const address = testUtils.randomAddress();

// Random wallet
const wallet = testUtils.randomWallet();

// Mock task result
const result = testUtils.mockTaskResult(true, { data: 'test' });
```

## Next Steps After Tests Pass

1. ✅ Review coverage report
2. ✅ Fix any failing tests
3. ✅ Address coverage gaps
4. ✅ Run linting: `npm run lint`
5. ✅ Format code: `npm run format`
6. ✅ Type check: `npm run typecheck`
7. ✅ Commit changes
8. ✅ Proceed to Sprint 3

## Support

For issues or questions:
1. Check TEST_SUMMARY.md
2. Review test output and error messages
3. Check mock configurations in test/setup.ts
4. Verify all dependencies are installed

## Success Checklist

Before moving to Sprint 3, ensure:
- [ ] All tests pass
- [ ] Coverage > 70%
- [ ] No console errors or warnings
- [ ] All linting passes
- [ ] TypeScript compiles without errors
- [ ] Documentation is up to date
- [ ] Git repository is clean

---

**Sprint 2 Testing Status**: ✅ READY FOR EXECUTION

Run `npm run test:sprint2` to begin!
