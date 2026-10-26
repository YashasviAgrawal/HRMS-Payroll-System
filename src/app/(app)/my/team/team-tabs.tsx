import { LinkTabs } from "@/components/ui/tabs";

export function TeamTabs({ active, labels }: { active: "people" | "attendance" | "leave"; labels: { people: string; attendance: string; leave: string } }) {
  return (
    <LinkTabs
      className="mb-5"
      active={active}
      tabs={[
        { key: "people", label: labels.people, href: "/my/team" },
        { key: "attendance", label: labels.attendance, href: "/my/team/attendance" },
        { key: "leave", label: labels.leave, href: "/my/team/leave" },
      ]}
    />
  );
}
