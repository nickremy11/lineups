export type Pos = "C" | "LW" | "RW" | "LD" | "RD" | "G";

export interface SkaterStats {
  gp: number;
  toi: number | null; // average seconds per game
  g: number;
  a: number;
  pm: number | null;
}
export interface GoalieStats {
  gp: number;
  w: number;
  gaa: number | null;
  svp: number | null;
}

export interface Player {
  id: string;
  name: string;
  number: number | null;
  pos: Pos;
  alt: Pos[]; // secondary positions
  shoots: "L" | "R" | null;
  headshot?: string;
  injury?: { status: string; note?: string };
  skater?: SkaterStats;
  goalie?: GoalieStats;
}

/** Lineup slots hold player ids (null = empty). */
export interface Lineup {
  f: (string | null)[][]; // 4 lines x [LW, C, RW]
  d: (string | null)[][]; // 3 pairs x [LD, RD]
  g: (string | null)[]; // [starter, backup]
  pp: (string | null)[][]; // 2 units x 5 skaters
  pk: (string | null)[][]; // 2 units x 4 skaters
}

export interface TeamPayload {
  team: { abbrev: string; name: string; logo: string; color?: string; color2?: string };
  players: Player[];
  lineup: Lineup;
  source: { name: string; url: string; updatedAt: string | null };
  warnings: string[];
}
