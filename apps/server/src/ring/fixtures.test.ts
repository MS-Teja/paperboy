import { readFileSync } from 'node:fs';
import { DeviceListSchema, DeviceStatusDocumentSchema, ErrorDocumentSchema, HistoryPageSchema } from 'ring-partner-kit';
import { describe, expect, it } from 'vitest';

// Real captured Ring responses (pnpm ring:capture) must keep parsing with the kit's schemas.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../fixtures/ring/${name}`, import.meta.url), 'utf8'));

describe('captured Ring fixtures', () => {
  it('parse the device list, including the included status', () => {
    const list = DeviceListSchema.parse(fixture('devices.json').body);
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.included?.some((r) => r.type === 'device-status')).toBe(true);
  });

  it('parse device status', () => {
    expect(DeviceStatusDocumentSchema.parse(fixture('device-status.json').body).data.attributes.online).toBeTypeOf('boolean');
  });

  it('parse history events, including the to-many cv_detections relationship', () => {
    for (const name of ['history-events.json', 'history-events-human-or-ding.json']) {
      const page = HistoryPageSchema.parse(fixture(name).body);
      for (const event of page.data) {
        expect(event.attributes.start).toBeTypeOf('number');
        expect(Array.isArray(event.relationships?.cv_detections?.data)).toBe(true);
      }
    }
  });

  it('parse the image download error document', () => {
    const errors = ErrorDocumentSchema.parse(fixture('image-download-latest-in-range.json').step2.body);
    expect(errors.errors[0]?.code).toBeTypeOf('string');
  });

  it('never contain image bytes', () => {
    const atEvent = fixture('image-download-at-event.json');
    expect(atEvent.step2.image_bytes).toBeTypeOf('number');
    expect(JSON.stringify(atEvent)).not.toMatch(/\/9j\/|base64/);
  });
});
