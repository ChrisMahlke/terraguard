// src/lib/risk.ts
import type { Facility, FacilityType } from "../slices/knowledgeSlice";

export type Severity = "low" | "moderate" | "high" | "critical" | null;

const SEVERITY_WEIGHT: Record<Exclude<Severity, null>, number> = {
  low: 10,
  moderate: 35,
  high: 60,
  critical: 80,
};

// normalize common need synonyms to canonical tokens
export function normalizeNeeds(needs: string[]): string[] {
  const canon: string[] = [];
  for (const raw of needs || []) {
    const n = (raw || "").toLowerCase().trim();
    if (!n) continue;
    if (/(emt|medic|injur|medical|first aid)/.test(n)) canon.push("medical");
    else if (/(rescue|trapped|us&r|usar)/.test(n)) canon.push("rescue");
    else if (/(evac|shelter|displace)/.test(n)) canon.push("evacuation");
    else if (/(fire|smoke|gas)/.test(n)) canon.push("fire");
    else if (/(utility|electric|power|lines|gas|water main)/.test(n))
      canon.push("utility");
    else if (/(public works|debris|sandbag|pump|road)/.test(n))
      canon.push("public-works");
    else if (/(security|crowd|police)/.test(n)) canon.push("security");
    else if (/(water)/.test(n)) canon.push("water");
    else if (/(food)/.test(n)) canon.push("food");
    else canon.push(n);
  }
  return Array.from(new Set(canon));
}

const NEED_WEIGHT: Record<string, number> = {
  medical: 25,
  rescue: 20,
  evacuation: 15,
  fire: 20,
  utility: 12,
  "public-works": 12,
  security: 10,
  water: 8,
  food: 8,
};

export function computeRiskScore({
  severity,
  needs,
  time_iso,
}: {
  severity: Severity;
  needs: string[];
  time_iso?: string | null;
}): number {
  let score = 0;

  if (severity && SEVERITY_WEIGHT[severity] != null) {
    score += SEVERITY_WEIGHT[severity];
  }

  const norm = normalizeNeeds(needs);
  const weights = norm
    .map((n) => NEED_WEIGHT[n] || 0)
    .sort((a, b) => b - a)
    .slice(0, 2);
  for (const w of weights) score += w;

  // time decay
  if (time_iso) {
    const t = Date.parse(time_iso);
    if (!isNaN(t)) {
      const ageH = (Date.now() - t) / (1000 * 60 * 60);
      if (ageH > 12) score *= 0.7;
      else if (ageH > 6) score *= 0.8;
      else if (ageH > 2) score *= 0.9;
    }
  } else {
    score *= 0.9;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Desired facility types by need
const NEED_TO_FACILITY: Record<string, FacilityType[]> = {
  medical: ["hospital"],
  rescue: ["fire"],
  fire: ["fire"],
  evacuation: ["shelter"],
  "public-works": ["public-works"],
  utility: ["utility"],
  water: ["public-works", "shelter"],
  food: ["shelter"],
  security: ["police"],
};

// Desired capability tags by need
const NEED_TO_CAPS: Record<string, string[]> = {
  medical: ["er", "trauma", "icu", "pediatric", "surgery", "helipad"],
  rescue: ["usar", "rope", "swiftwater", "hazmat"],
  fire: ["firefighting", "hazmat"],
  evacuation: ["shelter", "cots", "blankets", "accessible", "pets"],
  "public-works": ["pumps", "sandbags", "debris", "heavy-equipment"],
  utility: ["linecrew", "electric", "gas", "water", "substation"],
  water: ["water", "pumps", "bottled-water"],
  food: ["food", "meals"],
  security: ["crowd-control", "perimeter", "traffic"],
};

const TYPE_WEIGHT: Record<FacilityType, number> = {
  hospital: 30,
  fire: 25,
  shelter: 18,
  "public-works": 15,
  utility: 15,
  police: 12,
};

function scoreFacility(
  f: Facility,
  desiredTypes: Set<FacilityType>,
  desiredCaps: Set<string>
): number {
  let score = 0;

  // Type match weight
  if (desiredTypes.has(f.type)) {
    score += TYPE_WEIGHT[f.type] || 0;
  }

  // Capability matches (each weighted)
  const caps = (f.capabilities || []).map((c) => c.toLowerCase());
  let capMatches = 0;
  for (const c of caps) if (desiredCaps.has(c)) capMatches++;
  score += capMatches * 8; // each relevant capability adds 8 points

  return score;
}

export function suggestFacilities(
  needs: string[],
  facilities: Facility[],
  limit = 3
): Facility[] {
  const norm = normalizeNeeds(needs);
  if (norm.length === 0) return [];

  const desiredTypes = new Set<FacilityType>();
  const desiredCaps = new Set<string>();

  for (const n of norm) {
    (NEED_TO_FACILITY[n] || []).forEach((t) => desiredTypes.add(t));
    (NEED_TO_CAPS[n] || []).forEach((c) => desiredCaps.add(c));
  }

  const scored = facilities.map((f) => ({
    f,
    score: scoreFacility(f, desiredTypes, desiredCaps),
  }));

  scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map((s) => s.f);
}
