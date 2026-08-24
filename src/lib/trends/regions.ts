// Region list for the trend dashboard's region selector.
//
// The backend track owns region support server-side and may land its own
// `src/lib/trends/regions.ts` (or equivalent) this round. This is a
// placeholder defined independently so the frontend isn't blocked — if the
// backend's list differs in codes or labels once merged, reconcile by hand;
// consumers only depend on `Region`'s shape and `DEFAULT_REGION`.

export interface Region {
  code: string;
  label: string;
}

export const REGIONS: Region[] = [
  { code: "KR", label: "대한민국" },
  { code: "US", label: "United States" },
  { code: "JP", label: "日本" },
];

export const DEFAULT_REGION = REGIONS[0].code;
