import { z } from 'zod';

// Response shapes for the Ring Partner API (JSON:API documents). Objects are loose:
// Ring adds attributes over time, and unknown fields must not break parsing.

const ResourceIdentifier = z.object({ type: z.string(), id: z.string() });

const Relationship = z
  .object({
    data: ResourceIdentifier.nullable().optional(),
    links: z.object({ related: z.string().optional() }).loose().optional(),
  })
  .loose();

const Meta = z.object({ time: z.string().optional() }).loose();

export const DeviceSchema = z
  .object({
    type: z.literal('devices'),
    id: z.string(),
    attributes: z.object({ name: z.string() }).loose(),
    relationships: z.record(z.string(), Relationship).optional(),
  })
  .loose();

export const IncludedResourceSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const DeviceListSchema = z
  .object({
    meta: Meta.optional(),
    data: z.array(DeviceSchema),
    included: z.array(IncludedResourceSchema).optional(),
  })
  .loose();

export const DeviceStatusSchema = z
  .object({
    type: z.literal('device-status'),
    id: z.string(),
    attributes: z
      .object({
        online: z.boolean(),
        reported_at: z.string().optional(),
      })
      .loose(),
  })
  .loose();

export const DeviceStatusDocumentSchema = z
  .object({ meta: Meta.optional(), data: DeviceStatusSchema })
  .loose();

export const HistoryEventSchema = z
  .object({
    type: z.literal('history-events'),
    id: z.string(),
    attributes: z
      .object({
        event_type: z.string(),
        start: z.number(),
        end: z.number().optional(),
        is_third_party_reviewed: z.boolean().optional(),
      })
      .loose(),
    relationships: z.record(z.string(), Relationship).optional(),
  })
  .loose();

export const HistoryPageSchema = z
  .object({
    data: z.array(HistoryEventSchema),
    links: z.object({ next: z.string().optional() }).loose().optional(),
  })
  .loose();

export const ErrorDocumentSchema = z.object({
  errors: z.array(
    z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        code: z.string().optional(),
        title: z.string().optional(),
        detail: z.string().optional(),
      })
      .loose(),
  ),
});

export type Device = z.infer<typeof DeviceSchema>;
export type IncludedResource = z.infer<typeof IncludedResourceSchema>;
export type DeviceList = z.infer<typeof DeviceListSchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
export type HistoryPage = z.infer<typeof HistoryPageSchema>;
