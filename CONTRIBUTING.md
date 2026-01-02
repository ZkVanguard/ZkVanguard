# Contributing to ZkVanguard

Thank you for your interest in contributing to ZkVanguard! This document provides guidelines and instructions for contributing.

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/mrarejimmyz/zkvanguard.git
cd zkvanguard

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev
```

## 📝 Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Write clean, readable code
- Follow existing code style
- Add tests for new features
- Update documentation

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:agents
npm run test:contracts
npm run test:integration

# Check code quality
npm run lint
npm run typecheck
```

### 4. Commit Your Changes

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat: add new risk calculation method"
git commit -m "fix: resolve wallet connection issue"
git commit -m "docs: update API documentation"
git commit -m "test: add tests for hedge recommendations"
```

**Commit Types:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Test additions or updates
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear description of changes
- Link to related issues
- Screenshots/videos if applicable

## 🏗️ Project Structure

```
zkvanguard/
├── agents/           # AI agent implementations
│   ├── core/        # Core agent logic
│   ├── specialized/ # Specialized agents (Risk, Hedging, etc.)
│   └── communication/ # Agent coordination
├── app/             # Next.js app directory
├── components/      # React components
├── contracts/       # Solidity smart contracts
├── lib/             # Shared utilities and services
├── scripts/         # Deployment and utility scripts
├── test/            # Test suites
└── docs/            # Documentation
```

## 🧪 Testing Guidelines

### Writing Tests

- Place tests in `test/` directory
- Name test files with `.test.ts` extension
- Cover both success and failure cases
- Use descriptive test names

Example:

```typescript
describe('RiskAgent', () => {
  it('should calculate portfolio VaR correctly', async () => {
    const agent = new RiskAgent();
    const result = await agent.calculateVaR(mockPortfolio);
    expect(result.var95).toBeGreaterThan(0);
  });
});
```

### Test Coverage

Aim for:
- Unit tests: 80%+ coverage
- Integration tests: Key workflows
- E2E tests: Critical user journeys

## 📋 Code Style

### TypeScript

- Use TypeScript for all new code
- Provide proper type definitions
- Avoid `any` type when possible
- Use interfaces for data structures

### React/Next.js

- Use functional components with hooks
- Follow React best practices
- Use proper error boundaries
- Optimize performance (memoization, lazy loading)

### Solidity

- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Add comprehensive NatSpec comments
- Implement proper access control
- Write extensive tests for contracts

## 🔍 Code Review Process

All contributions go through code review:

1. **Automated Checks**: Tests, linting, type checking
2. **Peer Review**: At least one maintainer approval
3. **Documentation**: Ensure docs are updated
4. **Testing**: Verify all tests pass

## 🐛 Bug Reports

When reporting bugs, include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, browser)
- Screenshots/logs if applicable

Use the bug report template when creating an issue.

## 💡 Feature Requests

For new features:

- Describe the problem it solves
- Explain the proposed solution
- Consider backward compatibility
- Discuss potential implementation

## 📚 Documentation

Good documentation is crucial:

- Update README.md for user-facing changes
- Add JSDoc comments for functions
- Create guides for complex features
- Update API documentation

## 🔒 Security

- Never commit sensitive data (private keys, API keys)
- Use `.env.local` for local secrets
- Report security issues privately
- Follow secure coding practices

## 📞 Getting Help

- **Discord**: Join our community server
- **GitHub Issues**: For bugs and features
- **Discussions**: For questions and ideas

## 🎯 Priority Areas

We're especially interested in contributions for:

- 🤖 AI agent improvements
- 🔐 ZK proof optimizations
- 📊 Additional risk models
- 🧪 Test coverage expansion
- 📖 Documentation enhancements
- 🌐 Internationalization

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to ZkVanguard! 🚀
