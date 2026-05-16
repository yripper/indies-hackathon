import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateMediaSize,
  validateMimetype,
  sanitizePushName,
  isPrivateUrl,
  isMessageFlooding,
  clearRateLimitMapForTests,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from '../../src/security/input-validation';

describe('input-validation', () => {
  describe('validateMediaSize', () => {
    it('passes audio at exactly the max size', () => {
      const buffer = Buffer.alloc(MAX_AUDIO_BYTES);
      expect(validateMediaSize(buffer, 'audio')).toBe(true);
    });

    it('rejects audio exceeding the max size', () => {
      const buffer = Buffer.alloc(MAX_AUDIO_BYTES + 1);
      expect(validateMediaSize(buffer, 'audio')).toBe(false);
    });

    it('passes image well under the limit', () => {
      const buffer = Buffer.alloc(500 * 1024); // 500 KB
      expect(validateMediaSize(buffer, 'image')).toBe(true);
    });

    it('rejects image exceeding limit', () => {
      const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1);
      expect(validateMediaSize(buffer, 'image')).toBe(false);
    });

    it('passes video at exactly the max size', () => {
      const buffer = Buffer.alloc(MAX_VIDEO_BYTES);
      expect(validateMediaSize(buffer, 'video')).toBe(true);
    });

    it('rejects video exceeding limit', () => {
      const buffer = Buffer.alloc(MAX_VIDEO_BYTES + 1);
      expect(validateMediaSize(buffer, 'video')).toBe(false);
    });

    it('passes an empty buffer (zero bytes)', () => {
      const buffer = Buffer.alloc(0);
      expect(validateMediaSize(buffer, 'audio')).toBe(true);
    });
  });

  describe('validateMimetype', () => {
    it('accepts standard audio/ogg', () => {
      expect(validateMimetype('audio/ogg', 'audio')).toBe(true);
    });

    it('accepts audio/ogg with codecs parameter', () => {
      expect(validateMimetype('audio/ogg; codecs=opus', 'audio')).toBe(true);
    });

    it('accepts audio/mpeg', () => {
      expect(validateMimetype('audio/mpeg', 'audio')).toBe(true);
    });

    it('rejects application/pdf as audio', () => {
      expect(validateMimetype('application/pdf', 'audio')).toBe(false);
    });

    it('rejects video/mp4 as audio', () => {
      expect(validateMimetype('video/mp4', 'audio')).toBe(false);
    });

    it('accepts image/jpeg', () => {
      expect(validateMimetype('image/jpeg', 'image')).toBe(true);
    });

    it('accepts image/png', () => {
      expect(validateMimetype('image/png', 'image')).toBe(true);
    });

    it('accepts image/webp', () => {
      expect(validateMimetype('image/webp', 'image')).toBe(true);
    });

    it('rejects text/html as image', () => {
      expect(validateMimetype('text/html', 'image')).toBe(false);
    });

    it('accepts video/mp4', () => {
      expect(validateMimetype('video/mp4', 'video')).toBe(true);
    });

    it('accepts video/quicktime', () => {
      expect(validateMimetype('video/quicktime', 'video')).toBe(true);
    });

    it('rejects audio/mp4 as video', () => {
      expect(validateMimetype('audio/mp4', 'video')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(validateMimetype('IMAGE/JPEG', 'image')).toBe(true);
      expect(validateMimetype('Audio/OGG; codecs=opus', 'audio')).toBe(true);
    });

    it('handles extra whitespace', () => {
      expect(validateMimetype('  image/png  ', 'image')).toBe(true);
    });
  });

  describe('sanitizePushName', () => {
    it('returns empty string for null', () => {
      expect(sanitizePushName(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(sanitizePushName(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(sanitizePushName('')).toBe('');
    });

    it('passes through a normal name unchanged', () => {
      expect(sanitizePushName('Juan Perez')).toBe('Juan Perez');
    });

    it('preserves Unicode emojis and accented characters', () => {
      expect(sanitizePushName('Jose Fredes')).toBe('Jose Fredes');
    });

    it('removes null byte and other C0 control characters', () => {
      expect(sanitizePushName('hello\x00world')).toBe('helloworld');
      expect(sanitizePushName('\x01\x02\x03test')).toBe('test');
    });

    it('removes DEL character (0x7F)', () => {
      expect(sanitizePushName('test\x7Fname')).toBe('testname');
    });

    it('removes C1 control characters (0x80-0x9F)', () => {
      expect(sanitizePushName('test\x80\x85\x9Fname')).toBe('testname');
    });

    it('truncates to 100 characters', () => {
      const longName = 'A'.repeat(200);
      const result = sanitizePushName(longName);
      expect(result.length).toBe(100);
    });

    it('trims leading/trailing whitespace', () => {
      expect(sanitizePushName('  Juan  ')).toBe('Juan');
    });

    it('handles a name that is only control characters', () => {
      expect(sanitizePushName('\x00\x01\x02')).toBe('');
    });

    it('truncates AFTER removing control chars (net length)', () => {
      // 50 valid chars + 60 control chars + 60 valid chars
      // After removing control chars: 110 valid chars → truncated to 100
      const name = 'A'.repeat(50) + '\x00'.repeat(60) + 'B'.repeat(60);
      const result = sanitizePushName(name);
      expect(result.length).toBe(100);
      expect(result).toBe('A'.repeat(50) + 'B'.repeat(50));
    });
  });

  describe('isPrivateUrl', () => {
    it('blocks localhost', () => {
      expect(isPrivateUrl('http://localhost/path')).toBe(true);
    });

    it('blocks 127.0.0.1', () => {
      expect(isPrivateUrl('http://127.0.0.1:8080/api')).toBe(true);
    });

    it('blocks 0.0.0.0', () => {
      expect(isPrivateUrl('http://0.0.0.0/')).toBe(true);
    });

    it('blocks AWS metadata endpoint (169.254.169.254)', () => {
      expect(isPrivateUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    });

    it('blocks IPv6 loopback [::1]', () => {
      expect(isPrivateUrl('http://[::1]:3000/')).toBe(true);
    });

    it('blocks .internal suffix', () => {
      expect(isPrivateUrl('http://my-service.internal/api')).toBe(true);
    });

    it('blocks .local suffix', () => {
      expect(isPrivateUrl('http://printer.local/')).toBe(true);
    });

    it('blocks .localhost suffix', () => {
      expect(isPrivateUrl('http://evil.localhost/steal')).toBe(true);
    });

    it('blocks 10.x.x.x private range', () => {
      expect(isPrivateUrl('http://10.0.0.1/admin')).toBe(true);
      expect(isPrivateUrl('http://10.255.255.255/')).toBe(true);
    });

    it('blocks 172.16-31.x.x private range', () => {
      expect(isPrivateUrl('http://172.16.0.1/')).toBe(true);
      expect(isPrivateUrl('http://172.31.255.255/')).toBe(true);
    });

    it('does not block 172.32.x.x (outside private range)', () => {
      expect(isPrivateUrl('http://172.32.0.1/')).toBe(false);
    });

    it('blocks 192.168.x.x private range', () => {
      expect(isPrivateUrl('http://192.168.1.1/')).toBe(true);
    });

    it('allows a legitimate public URL', () => {
      expect(isPrivateUrl('https://api.realitydefender.com/v1/detect')).toBe(false);
    });

    it('allows another public URL', () => {
      expect(isPrivateUrl('https://cdn.whatsapp.net/video/abc123.mp4')).toBe(false);
    });

    it('blocks unparseable URLs (fail-closed)', () => {
      expect(isPrivateUrl('not-a-url')).toBe(true);
      expect(isPrivateUrl('')).toBe(true);
    });
  });

  describe('isMessageFlooding', () => {
    beforeEach(() => {
      clearRateLimitMapForTests();
    });

    it('returns false for the first message from a JID', () => {
      expect(isMessageFlooding('5491100001111@s.whatsapp.net')).toBe(false);
    });

    it('returns false while under the limit', () => {
      const jid = '5491100002222@s.whatsapp.net';
      for (let i = 0; i < 19; i++) {
        expect(isMessageFlooding(jid)).toBe(false);
      }
    });

    it('returns true when reaching 20 messages (the limit)', () => {
      const jid = '5491100003333@s.whatsapp.net';
      // Send exactly 20 messages
      for (let i = 0; i < 20; i++) {
        isMessageFlooding(jid);
      }
      // The 21st should be blocked
      expect(isMessageFlooding(jid)).toBe(true);
    });

    it('returns true when exceeding 20 messages within the window', () => {
      const jid = '5491100004444@s.whatsapp.net';
      for (let i = 0; i < 20; i++) {
        isMessageFlooding(jid);
      }
      // All subsequent calls should return true
      expect(isMessageFlooding(jid)).toBe(true);
      expect(isMessageFlooding(jid)).toBe(true);
    });

    it('tracks JIDs independently', () => {
      const jid1 = '5491100005555@s.whatsapp.net';
      const jid2 = '5491100006666@s.whatsapp.net';

      // Exhaust jid1
      for (let i = 0; i < 20; i++) {
        isMessageFlooding(jid1);
      }

      // jid2 should still be allowed
      expect(isMessageFlooding(jid2)).toBe(false);
      // jid1 should be blocked
      expect(isMessageFlooding(jid1)).toBe(true);
    });
  });
});
