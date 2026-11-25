import { z } from "zod";

import {
  latitudeField,
  longitudeField,
  requiredString,
} from "@/schemas/shared/fields";

const requiredCoordinate = (
  field: typeof latitudeField | typeof longitudeField,
  label: "Latitude" | "Longitude",
) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    // The API persists coordinates as DecimalField(..., decimal_places=6).
    // Validate that representation here so a value that appears valid in the
    // browser cannot fail only after the save request.
    .refine(
      (value) => /^[-+]?(?:\d+|\d*\.\d{1,6})$/.test(value),
      `${label} must be a number with up to 6 decimal places`,
    )
    .transform((value, ctx) => {
      const result = field.safeParse(value);
      if (!result.success) {
        result.error.issues.forEach((issue) =>
          ctx.addIssue({ code: "custom", message: issue.message }),
        );
        return z.NEVER;
      }
      return result.data;
    });

/**
 * BinCollectionEventForm's submit handler guarded these fields before save:
 *  - trip_assignment_id / bin_id: always required (the top-level `if` check).
 *  - collected_weight_kg: required only when status is "Collected"
 *    (nullable on the backend for Not Collected / Collect Later).
 * GPS coordinates are required for every manual secondary-bin event so the
 * collection record can be verified, regardless of its status.
 */
export const binCollectionEventSchema = z
  .object({
    trip_assignment_id: requiredString("Trip Assignment"),
    bin_id: requiredString("Bin"),
    status: z.string(),
    collected_weight_kg: z.string(),
    driver_latitude: requiredCoordinate(latitudeField, "Latitude"),
    driver_longitude: requiredCoordinate(longitudeField, "Longitude"),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Collected" && !data.collected_weight_kg.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["collected_weight_kg"],
        message: "Collected weight is required when status is Collected.",
      });
    }
  });

export type BinCollectionEventFormValues = z.infer<typeof binCollectionEventSchema>;
