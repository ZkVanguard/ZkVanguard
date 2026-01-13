# Geo-Blocking Implementation Guide

## Overview

ZK Vanguard implements geo-blocking to comply with international sanctions and regulatory requirements. This document outlines the implementation details and maintenance procedures.

## Blocked Jurisdictions

The following jurisdictions are blocked due to OFAC sanctions and regulatory requirements:

| Country | ISO Code | Reason |
|---------|----------|--------|
| North Korea | KP | OFAC Sanctions |
| Iran | IR | OFAC Sanctions |
| Syria | SY | OFAC Sanctions |
| Cuba | CU | OFAC Sanctions |
| Crimea Region | UA-43 | OFAC Sanctions |
| Russia | RU | OFAC Sanctions |
| Belarus | BY | EU/US Sanctions |

## Implementation Architecture

### 1. Middleware-Based Blocking (Primary)

**File:** `middleware.ts`

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BLOCKED_COUNTRIES = ['KP', 'IR', 'SY', 'CU', 'RU', 'BY'];

export function middleware(request: NextRequest) {
  // Get country from Vercel's geo headers
  const country = request.geo?.country || request.headers.get('x-vercel-ip-country');
  
  if (country && BLOCKED_COUNTRIES.includes(country)) {
    return new NextResponse(
      JSON.stringify({
        error: 'Service unavailable in your region',
        code: 'GEO_BLOCKED'
      }),
      { 
        status: 451, // Unavailable For Legal Reasons
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*', '/swap/:path*']
};
```

### 2. API Route Protection (Secondary)

**File:** `lib/middleware/geoCheck.ts`

```typescript
import { NextRequest } from 'next/server';

const BLOCKED_COUNTRIES = ['KP', 'IR', 'SY', 'CU', 'RU', 'BY'];

export function isGeoBlocked(request: NextRequest): boolean {
  const country = request.geo?.country || 
                  request.headers.get('x-vercel-ip-country') ||
                  request.headers.get('cf-ipcountry'); // Cloudflare fallback
  
  return country ? BLOCKED_COUNTRIES.includes(country) : false;
}

export function getGeoBlockResponse() {
  return Response.json(
    { 
      error: 'This service is not available in your region due to regulatory requirements.',
      code: 'GEO_RESTRICTED',
      support: 'compliance@zkvanguard.io'
    },
    { status: 451 }
  );
}
```

### 3. Frontend Warning Component

**File:** `components/GeoWarning.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';

export function GeoWarning() {
  const [showWarning, setShowWarning] = useState(false);
  
  useEffect(() => {
    // Check if user might be using VPN from restricted region
    fetch('/api/geo-check')
      .then(res => res.json())
      .then(data => {
        if (data.warning) {
          setShowWarning(true);
        }
      })
      .catch(() => {});
  }, []);
  
  if (!showWarning) return null;
  
  return (
    <div className="bg-yellow-500/10 border border-yellow-500 p-4 rounded-lg mb-4">
      <p className="text-yellow-500 text-sm">
        ⚠️ Please ensure you are accessing this service from a permitted jurisdiction.
        Using VPNs to circumvent geo-restrictions may violate our Terms of Service.
      </p>
    </div>
  );
}
```

## Vercel Configuration

### Edge Network Geo Headers

Vercel automatically provides geo-location headers:

- `x-vercel-ip-country`: ISO 3166-1 alpha-2 country code
- `x-vercel-ip-country-region`: Region/state code
- `x-vercel-ip-city`: City name
- `x-vercel-ip-latitude`: Latitude
- `x-vercel-ip-longitude`: Longitude

### vercel.json Configuration

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options", 
          "value": "DENY"
        }
      ]
    }
  ]
}
```

## VPN Detection (Optional Enhancement)

For enhanced compliance, consider implementing VPN detection:

### Option 1: IP Intelligence Service

```typescript
// lib/services/vpnDetection.ts
import { NextRequest } from 'next/server';

interface IPIntelligence {
  isVPN: boolean;
  isProxy: boolean;
  isTor: boolean;
  isDatacenter: boolean;
  riskScore: number;
}

export async function checkIPIntelligence(ip: string): Promise<IPIntelligence> {
  // Integration with services like:
  // - IPinfo.io
  // - MaxMind GeoIP2
  // - IP2Location
  
  const response = await fetch(`https://ipinfo.io/${ip}?token=${process.env.IPINFO_TOKEN}`);
  const data = await response.json();
  
  return {
    isVPN: data.privacy?.vpn || false,
    isProxy: data.privacy?.proxy || false,
    isTor: data.privacy?.tor || false,
    isDatacenter: data.privacy?.hosting || false,
    riskScore: calculateRiskScore(data)
  };
}
```

### Option 2: Behavioral Analysis

```typescript
// Detect VPN through latency analysis
export async function detectVPNByLatency(
  declaredCountry: string,
  measuredLatency: number
): Promise<boolean> {
  // If latency doesn't match expected range for country, flag as potential VPN
  const expectedLatency = COUNTRY_LATENCY_MAP[declaredCountry];
  return Math.abs(measuredLatency - expectedLatency) > THRESHOLD;
}
```

## Compliance Logging

All geo-blocks should be logged for compliance audits:

```typescript
// lib/services/complianceLogger.ts
interface GeoBlockLog {
  timestamp: Date;
  ip: string; // Hashed for privacy
  country: string;
  endpoint: string;
  userAgent: string;
  action: 'blocked' | 'warned';
}

export async function logGeoBlock(log: GeoBlockLog): Promise<void> {
  // Store in compliance database
  await db.complianceLogs.create({
    data: {
      ...log,
      ip: hashIP(log.ip), // Never store raw IPs
      retentionDate: addDays(new Date(), 90) // 90-day retention
    }
  });
}
```

## Testing Geo-Blocking

### Local Development

Use environment variables to simulate geo-blocking:

```bash
# .env.local
GEO_OVERRIDE=KP  # Simulate North Korea for testing
```

```typescript
// middleware.ts (development only)
if (process.env.NODE_ENV === 'development' && process.env.GEO_OVERRIDE) {
  const country = process.env.GEO_OVERRIDE;
  // Test blocking logic
}
```

### Production Testing

1. **Vercel Preview with Headers**:
   ```bash
   curl -H "x-vercel-ip-country: KP" https://preview.zkvanguard.vercel.app/api/health
   ```

2. **VPN Testing**:
   - Use a VPN service to connect from blocked regions
   - Verify 451 response is returned
   - Check compliance logs are created

## Updating Blocked Countries

When sanctions lists change:

1. **Update the blocklist**:
   ```typescript
   // lib/constants/geoBlocking.ts
   export const BLOCKED_COUNTRIES = [
     'KP', // North Korea
     'IR', // Iran
     'SY', // Syria
     'CU', // Cuba
     'RU', // Russia
     'BY', // Belarus
     // Add new countries here
   ];
   ```

2. **Update documentation**:
   - Update this file
   - Update Terms of Service
   - Notify legal team

3. **Deploy and verify**:
   ```bash
   vercel deploy --prod
   # Test with curl commands
   ```

## Legal Considerations

### Terms of Service Disclosure

Include in ToS:
```
Geographic Restrictions: Our services are not available to residents of, 
or persons located in, jurisdictions subject to comprehensive U.S. sanctions 
(currently including Cuba, Iran, North Korea, Syria, and the Crimea region) 
or other restricted jurisdictions. By using our services, you represent that 
you are not located in any such jurisdiction.
```

### Privacy Policy

Include:
```
Location Data: We collect your approximate geographic location based on 
IP address to comply with applicable sanctions laws and regulations. 
This data is processed solely for compliance purposes and retained for 
90 days.
```

## Monitoring & Alerts

Set up monitoring for:

1. **Unusual blocked traffic volumes** - May indicate VPN circumvention attempts
2. **API errors from blocked regions** - Verify blocking is working
3. **Legal/sanctions list updates** - OFAC updates quarterly

### Alert Configuration (Vercel/Datadog)

```yaml
# datadog-monitors.yaml
- name: "High Volume Geo-Blocks"
  query: "sum(last_1h):sum:geo.blocks{*} > 1000"
  message: "Unusual volume of geo-blocked requests. Investigate for potential circumvention."
  
- name: "Geo-Block Failures"
  query: "sum(last_5m):sum:geo.block.errors{*} > 10"
  message: "Geo-blocking middleware errors detected."
```

## Incident Response

If a blocked user gains access:

1. **Immediate**: Block the specific IP/session
2. **Investigation**: Review logs for how access was gained
3. **Remediation**: Patch the bypass method
4. **Documentation**: Create incident report for compliance
5. **Notification**: Inform legal team if required

---

## Summary Checklist

- [x] Middleware-based blocking implemented
- [x] API route protection added
- [x] 451 status code used (Unavailable For Legal Reasons)
- [x] Compliance logging enabled
- [x] Terms of Service updated
- [x] Privacy Policy updated
- [x] Testing procedures documented
- [x] Monitoring alerts configured
- [ ] VPN detection (optional enhancement)
- [ ] IP intelligence integration (optional)

---

*Last Updated: January 13, 2026*
*Next Review: April 13, 2026 (Quarterly)*
