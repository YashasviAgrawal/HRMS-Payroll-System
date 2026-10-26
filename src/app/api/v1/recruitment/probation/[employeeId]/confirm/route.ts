import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { isoDateField } from "@/lib/validators";
import { addServiceEntry } from "@/modules/employees/records";

/** RO-08: confirmation is recorded in the service book (Checker); approval sets the confirmation date. */
export const POST = apiRoute<{ employeeId: string }>(async ({ actor, params, body }) => {
  const input = await body(z.object({ eventDate: isoDateField, orderNumber: z.string().max(80).optional(), orderDate: isoDateField.optional() }));
  const entry = await addServiceEntry(actor, params.employeeId, {
    event: "CONFIRMATION",
    eventDate: input.eventDate,
    orderNumber: input.orderNumber,
    orderDate: input.orderDate,
    details: "Confirmed in service on successful completion of probation.",
    detailsHi: "परिवीक्षा सफलतापूर्वक पूरी होने पर सेवा में स्थायीकरण।",
  });
  return { id: entry.id };
});
