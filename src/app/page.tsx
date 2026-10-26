import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";

export default async function Index() {
  redirect((await getActor()) ? "/home" : "/login");
}
