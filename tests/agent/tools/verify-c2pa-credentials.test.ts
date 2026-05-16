import { describe, it, expect } from 'vitest';
import { classifyC2pa } from '../../../src/agent/tools/verify-c2pa-credentials';
import type { TrustedIssuer } from '../../../src/agent/tools/lib/load-trust-list';

const trustList: TrustedIssuer[] = [
  { o: 'OpenAI', category: 'ai_generator' },
  { o: 'Sony Group Corporation', category: 'camera' },
];

describe('classifyC2pa', () => {
  it('returns the "no manifest" string when reader produced nothing', () => {
    expect(classifyC2pa(null, trustList)).toMatch(/No C2PA manifest present/);
  });

  it('returns the "no manifest" string when store has no active manifest', () => {
    expect(classifyC2pa({ manifests: {} }, trustList)).toMatch(/No C2PA manifest present/);
  });

  it('returns the trusted-issuer string when issuer is in the trust list', () => {
    const out = classifyC2pa(
      {
        active_manifest: 'urn:uuid:1',
        manifests: {
          'urn:uuid:1': {
            claim_generator: 'OpenAI DALL-E 3 / c2pa-rs/0.13.0',
            signature_info: {
              issuer: 'CN=Content Credentials, O=OpenAI, Inc.',
              timeObject: new Date('2026-03-15T14:22:00Z'),
            },
          },
        },
        validation_status: [],
      },
      trustList,
    );
    expect(out).toMatch(/manifest verified/);
    expect(out).toMatch(/category=ai_generator/);
    expect(out).toMatch(/2026-03-15T14:22:00/);
  });

  it('returns the untrusted-issuer string when valid signature comes from unknown org', () => {
    const out = classifyC2pa(
      {
        active_manifest: 'urn:uuid:2',
        manifests: {
          'urn:uuid:2': {
            claim_generator: 'random-tool/1.0',
            signature_info: { issuer: 'CN=Random Self-Signed Cert, O=SomeOrg' },
          },
        },
        validation_status: [],
      },
      trustList,
    );
    expect(out).toMatch(/not in our trust list/);
    expect(out).toMatch(/soft signal/);
  });

  it('returns the tampered string when validation_status has failures', () => {
    const out = classifyC2pa(
      {
        active_manifest: 'urn:uuid:3',
        manifests: {
          'urn:uuid:3': {
            claim_generator: 'whatever',
            signature_info: { issuer: 'O=OpenAI' },
          },
        },
        validation_status: [
          { code: 'signature.untrusted', explanation: 'cert chain broken' },
          { code: 'assertion.hashedURI.mismatch' },
        ],
      },
      trustList,
    );
    expect(out).toMatch(/signature verification FAILED/);
    expect(out).toMatch(/signature.untrusted/);
    expect(out).toMatch(/assertion.hashedURI.mismatch/);
    expect(out).toMatch(/tampering or forged/);
  });
});
