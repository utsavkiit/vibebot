const AUTO_DEV_BASE_URL = 'https://api.auto.dev/listings';

export interface Listing {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  price: number;
  mileage: number;
  dealerName: string;
  dealerCity: string;
  dealerState: string;
  url: string;
}

interface AutoDevItem {
  vehicle?: Record<string, unknown>;
  retailListing?: Record<string, unknown>;
  vin?: string;
}

interface AutoDevResponse {
  data?: AutoDevItem[];
}

export async function fetchMacanListings(
  zipCode: string,
  distance: number,
  yearMin: number,
  yearMax: number,
  maxPrice: number,
  maxMileage: number,
): Promise<Listing[]> {
  const apiKey = process.env.AUTO_DEV_API_KEY;
  if (!apiKey) throw new Error('AUTO_DEV_API_KEY is not set in the environment.');

  const params = new URLSearchParams({
    'vehicle.make': 'Porsche',
    'vehicle.model': 'Macan',
    'vehicle.year': `${yearMin}-${yearMax}`,
    'retailListing.miles': `1-${maxMileage}`,
    'retailListing.price': `1-${maxPrice}`,
    zip: zipCode,
    distance: String(distance),
  });

  const response = await fetch(`${AUTO_DEV_BASE_URL}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`auto.dev API returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as AutoDevResponse;
  const raw = data.data ?? [];
  const listings: Listing[] = [];

  for (const item of raw) {
    const vehicle = (item.vehicle ?? {}) as Record<string, unknown>;
    const retail = (item.retailListing ?? {}) as Record<string, unknown>;

    const vin = String(vehicle['vin'] ?? item.vin ?? '');
    if (!vin) continue;

    listings.push({
      vin,
      year: Number(vehicle['year'] ?? 0),
      make: String(vehicle['make'] ?? 'Porsche'),
      model: String(vehicle['model'] ?? 'Macan'),
      trim: String(vehicle['series'] ?? vehicle['trim'] ?? ''),
      price: Number(retail['price'] ?? 0),
      mileage: Number(retail['miles'] ?? 0),
      dealerName: String(retail['dealer'] ?? 'Unknown Dealer'),
      dealerCity: '',
      dealerState: '',
      url: String(retail['vdp'] ?? retail['url'] ?? ''),
    });
  }

  return listings;
}
