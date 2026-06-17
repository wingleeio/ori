export interface Person {
  name: string;
  role: string;
}

export const PEOPLE: Person[] = [
  { name: "Ada Lovelace", role: "Mathematician" },
  { name: "Alan Turing", role: "Computer scientist" },
  { name: "Grace Hopper", role: "Rear admiral" },
  { name: "Katherine Johnson", role: "Mathematician" },
  { name: "Margaret Hamilton", role: "Software engineer" },
  { name: "Donald Knuth", role: "Computer scientist" },
  { name: "Barbara Liskov", role: "Computer scientist" },
  { name: "Edsger Dijkstra", role: "Computer scientist" },
  { name: "Hedy Lamarr", role: "Inventor" },
  { name: "Claude Shannon", role: "Information theorist" },
];

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

// Literal class strings so Tailwind's scanner generates them.
const AVATAR_COLORS = [
  "bg-rose-500/20 text-rose-300",
  "bg-sky-500/20 text-sky-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-amber-500/20 text-amber-300",
  "bg-violet-500/20 text-violet-300",
  "bg-cyan-500/20 text-cyan-300",
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function filterPeople(query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return PEOPLE;
  return PEOPLE.filter(
    (p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q),
  );
}
