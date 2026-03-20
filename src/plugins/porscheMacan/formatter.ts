import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Listing } from './fetcher';

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export function rankListings(listings: Listing[], topN: number = 5): Listing[] {
  if (!listings.length) return [];

  const years = listings.map((l) => l.year);
  const prices = listings.map((l) => l.price);
  const miles = listings.map((l) => l.mileage);

  const normAsc = (v: number, lo: number, hi: number) => (hi !== lo ? (v - lo) / (hi - lo) : 0.5);
  const normDesc = (v: number, lo: number, hi: number) => (hi !== lo ? (hi - v) / (hi - lo) : 0.5);

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minMiles = Math.min(...miles);
  const maxMiles = Math.max(...miles);

  const scored = listings.map((l) => ({
    listing: l,
    score:
      0.35 * normDesc(l.price, minPrice, maxPrice) +
      0.35 * normDesc(l.mileage, minMiles, maxMiles) +
      0.3 * normAsc(l.year, minYear, maxYear),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.listing);
}

// ---------------------------------------------------------------------------
// LLM buyer's note
// ---------------------------------------------------------------------------

const NOTE_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    'You are a concise, knowledgeable car-buying advisor. ' +
      'Write exactly ONE sentence of buyer\'s advice for the listing below. ' +
      'Maximum 15 words. Focus on value, trim highlights, or a practical tip. ' +
      'Do not repeat the year, make, or model. No filler like \'This is\'.',
  ],
  [
    'human',
    'Trim: {trim}\nPrice: ${price}\nMileage: {mileage} miles\nDealer: {dealerName}, {dealerCity}, {dealerState}',
  ],
]);

export async function generateBuyersNote(llm: BaseChatModel, listing: Listing): Promise<string> {
  try {
    const chain = NOTE_PROMPT.pipe(llm).pipe(new StringOutputParser());
    return (
      await chain.invoke({
        trim: listing.trim || 'base',
        price: listing.price.toLocaleString(),
        mileage: listing.mileage.toLocaleString(),
        dealerName: listing.dealerName,
        dealerCity: listing.dealerCity,
        dealerState: listing.dealerState,
      })
    ).trim();
  } catch {
    return '';
  }
}
