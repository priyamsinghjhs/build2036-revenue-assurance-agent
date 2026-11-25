/** Refuse small-talk and other questions that are not about the revenue-assurance book. */

const OOS =
  /\b(weather|forecast|temperature|humidity|rain(fall)?|snow|uv\s*index|air\s*quality)\b|\b(poem|poetry|haiku|sonnet|limerick|lyrics?|joke|riddle|prank)\b|\b(recipe|cookbook|ingredients?)\b|\b(who won|sports?\s*score|premier league|world cup|cricket score)\b|\b(horoscope|zodiac|astrology)\b|\b(translate this|write (me )?a (story|song|essay))\b|\bwhat('?s| is) the (capital|population) of\b/i;

export function isOutOfScopeQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (OOS.test(q)) return true;
  return false;
}

export const OUT_OF_SCOPE_MESSAGE =
  "That question is outside the revenue-assurance book. Ask about leakage, exceptions, settlements, merchants, recovery, or other book metrics.";
