import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";

/** Every Release 1 module is built; any other path inside the app is a 404 (after sign-in, so nothing leaks). */
export default async function UnknownPage() {
  await requireActor();
  notFound();
}
