# Pre-Commit Checklist

Use this checklist before pushing code to GitHub.

## ✅ Code Quality

- [ ] All TypeScript errors resolved (`npm run typecheck`)
- [ ] All tests passing (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code formatted (`npm run format`)
- [ ] No `console.log` statements in production code
- [ ] No TODO/FIXME comments for critical issues

## 🔒 Security

- [ ] `.env.local` not committed (contains private keys)
- [ ] No API keys or secrets in code
- [ ] No hardcoded passwords or tokens
- [ ] Private keys properly excluded in `.gitignore`
- [ ] Dependencies up to date (`npm audit`)

## 📚 Documentation

- [ ] README updated if features changed
- [ ] CHANGELOG updated with version changes
- [ ] Code comments added for complex logic
- [ ] API documentation updated (if applicable)
- [ ] README badges reflect current status

## 🧪 Testing

- [ ] Unit tests added for new features
- [ ] Integration tests passing
- [ ] E2E tests passing (if applicable)
- [ ] Test coverage maintained (>80%)
- [ ] Edge cases covered

## 📦 Build & Deploy

- [ ] Build succeeds locally (`npm run build`)
- [ ] No build warnings or errors
- [ ] Vercel deployment preview looks correct
- [ ] Smart contracts compile (`npm run compile`)
- [ ] Environment variables set in Vercel

## 🎨 UI/UX (Frontend Changes)

- [ ] Responsive design works (mobile, tablet, desktop)
- [ ] Dark/light theme tested
- [ ] Loading states implemented
- [ ] Error states handled gracefully
- [ ] Accessibility checked (WCAG 2.1 AA)

## 🔗 GitHub

- [ ] Branch name follows convention (`feature/`, `fix/`, `docs/`)
- [ ] Commit messages follow Conventional Commits
- [ ] Pull request description filled out
- [ ] Related issues linked
- [ ] Screenshots/videos added (if UI changes)

## 📋 Final Checks

- [ ] Changes tested on fresh install (`rm -rf node_modules && npm install`)
- [ ] No merge conflicts
- [ ] All CI checks pass on GitHub
- [ ] Approved by at least one reviewer
- [ ] Updated package version (if releasing)

---

## Quick Commands

```bash
# Full pre-commit check
npm run typecheck && npm run lint && npm test && npm run build

# Fix formatting and linting
npm run format && npm run lint:fix

# Update dependencies
npm update && npm audit fix

# Clean install
rm -rf node_modules package-lock.json && npm install
```

---

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

**Examples**:
```
feat(agents): add risk agent portfolio analysis
fix(dashboard): resolve wallet connection issue
docs(readme): update installation instructions
test(contracts): add tests for ZKVerifier
```

---

**Pro Tip**: Use `git commit --no-verify` to bypass pre-commit hooks only when absolutely necessary (not recommended for main branch).
