# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, please send an e-mail to security@zkvanguard.io or report it through our [security advisory page](https://github.com/mrarejimmyz/zkvanguard/security/advisories/new).

### What to Include

Please include the following information in your report:

- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Status Update**: Every 7 days until resolution
- **Fix Release**: Depends on severity and complexity

## Security Best Practices

### For Users

- Never commit `.env.local` or files containing private keys
- Use strong, unique private keys for production
- Regularly update dependencies: `npm audit fix`
- Enable 2FA on all accounts with repository access

### For Contributors

- Review [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- Follow secure coding guidelines
- Use parameterized queries to prevent injection
- Validate and sanitize all user inputs
- Keep dependencies up to date
- Run security checks: `npm audit`

## Smart Contract Security

Our smart contracts follow best practices:

- OpenZeppelin battle-tested contracts
- Comprehensive test coverage (>90%)
- Access control mechanisms
- Reentrancy guards
- Integer overflow protection
- Emergency pause functionality

### Audit Status

- [ ] Internal security review completed
- [ ] External audit scheduled
- [ ] Bug bounty program (coming soon)

## Known Security Considerations

### Private Keys

- Private keys in `.env.local` are for **testnet only**
- Never use testnet keys on mainnet
- Use hardware wallets for production
- Implement key rotation policies

### API Keys

- Crypto.com Developer API keys are free but rate-limited
- Store API keys in environment variables
- Never hardcode keys in source code
- Rotate keys periodically

### Smart Contracts

- All contracts deployed to testnet first
- Mainnet deployments require multi-sig approval
- Emergency pause mechanism available
- Upgrade mechanisms follow proxy patterns

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine affected versions
2. Audit code to find similar problems
3. Prepare fixes for supported versions
4. Release patches as soon as possible

## Comments on This Policy

If you have suggestions on how this process could be improved, please submit a pull request.

---

**Last Updated**: January 2, 2026
