/* reference.js — §18's bundled tables, and the date they were checked.
 *
 * §3: "Bundled data shows its date." Reference data goes stale — countries
 * redenominate currencies, capitals move, dialling codes get reassigned — and
 * a stale row looks exactly as confident as a fresh one. So every read out of
 * this file returns provenance.kind = "bundled" with TABLES_AS_OF attached,
 * and contracts.js throws if a caller forgets.
 *
 * Note what is NOT here: exchange rates. §9 of the skill index is titled
 * "Finance math (rates always supplied, never assumed)", and a bundled rate is
 * the one kind of stale data that costs money when acted on. convertCurrencyFixed
 * takes the rate as an input; the live one is a Web-tier skill that is not in
 * this build. `decimals` below IS bundled, because the number of minor units in
 * a currency is a property of the currency and not a market price. */

export const TABLES_AS_OF = '2026-08-29';

/* code → [name, symbol, minor-unit decimals] */
const C = {
  EUR: ['euro', '€', 2], USD: ['US dollar', '$', 2], GBP: ['pound sterling', '£', 2],
  JPY: ['Japanese yen', '¥', 0], CHF: ['Swiss franc', 'CHF', 2],
  AUD: ['Australian dollar', 'A$', 2], CAD: ['Canadian dollar', 'C$', 2],
  NZD: ['New Zealand dollar', 'NZ$', 2], CNY: ['Chinese yuan', '¥', 2],
  INR: ['Indian rupee', '₹', 2], SGD: ['Singapore dollar', 'S$', 2],
  HKD: ['Hong Kong dollar', 'HK$', 2], SEK: ['Swedish krona', 'kr', 2],
  NOK: ['Norwegian krone', 'kr', 2], DKK: ['Danish krone', 'kr', 2],
  PLN: ['Polish złoty', 'zł', 2], CZK: ['Czech koruna', 'Kč', 2],
  HUF: ['Hungarian forint', 'Ft', 2], RON: ['Romanian leu', 'lei', 2],
  BGN: ['Bulgarian lev', 'лв', 2], TRY: ['Turkish lira', '₺', 2],
  ZAR: ['South African rand', 'R', 2], BRL: ['Brazilian real', 'R$', 2],
  MXN: ['Mexican peso', '$', 2], ARS: ['Argentine peso', '$', 2],
  CLP: ['Chilean peso', '$', 0], COP: ['Colombian peso', '$', 2],
  PEN: ['Peruvian sol', 'S/', 2], KRW: ['South Korean won', '₩', 0],
  THB: ['Thai baht', '฿', 2], MYR: ['Malaysian ringgit', 'RM', 2],
  IDR: ['Indonesian rupiah', 'Rp', 2], PHP: ['Philippine peso', '₱', 2],
  VND: ['Vietnamese dong', '₫', 0], AED: ['UAE dirham', 'د.إ', 2],
  SAR: ['Saudi riyal', '﷼', 2], QAR: ['Qatari riyal', '﷼', 2],
  ILS: ['Israeli new shekel', '₪', 2], EGP: ['Egyptian pound', 'E£', 2],
  NGN: ['Nigerian naira', '₦', 2], KES: ['Kenyan shilling', 'KSh', 2],
  GHS: ['Ghanaian cedi', '₵', 2], MAD: ['Moroccan dirham', 'DH', 2],
  ISK: ['Icelandic króna', 'kr', 0], UAH: ['Ukrainian hryvnia', '₴', 2],
  RUB: ['Russian rouble', '₽', 2], PKR: ['Pakistani rupee', '₨', 2],
  BDT: ['Bangladeshi taka', '৳', 2], LKR: ['Sri Lankan rupee', 'Rs', 2],
  TWD: ['New Taiwan dollar', 'NT$', 2], KWD: ['Kuwaiti dinar', 'د.ك', 3],
  BHD: ['Bahraini dinar', '.د.ب', 3], OMR: ['Omani rial', '﷼', 3],
  JOD: ['Jordanian dinar', 'د.ا', 3], TND: ['Tunisian dinar', 'د.ت', 3],
  ETB: ['Ethiopian birr', 'Br', 2], AFN: ['Afghan afghani', '؋', 2]
};

export const CURRENCIES = Object.fromEntries(
  Object.entries(C).map(([code, [name, symbol, decimals]]) => [code, { code, name, symbol, decimals }])
);

/* name → [ISO-2, ISO-3, capital, currency code, dial code] */
const K = {
  Afghanistan: ['AF', 'AFG', 'Kabul', 'AFN', '+93'],
  Argentina: ['AR', 'ARG', 'Buenos Aires', 'ARS', '+54'],
  Australia: ['AU', 'AUS', 'Canberra', 'AUD', '+61'],
  Austria: ['AT', 'AUT', 'Vienna', 'EUR', '+43'],
  Bangladesh: ['BD', 'BGD', 'Dhaka', 'BDT', '+880'],
  Belgium: ['BE', 'BEL', 'Brussels', 'EUR', '+32'],
  Brazil: ['BR', 'BRA', 'Brasília', 'BRL', '+55'],
  Bulgaria: ['BG', 'BGR', 'Sofia', 'BGN', '+359'],
  Canada: ['CA', 'CAN', 'Ottawa', 'CAD', '+1'],
  Chile: ['CL', 'CHL', 'Santiago', 'CLP', '+56'],
  China: ['CN', 'CHN', 'Beijing', 'CNY', '+86'],
  Colombia: ['CO', 'COL', 'Bogotá', 'COP', '+57'],
  Croatia: ['HR', 'HRV', 'Zagreb', 'EUR', '+385'],
  Cyprus: ['CY', 'CYP', 'Nicosia', 'EUR', '+357'],
  'Czech Republic': ['CZ', 'CZE', 'Prague', 'CZK', '+420'],
  Denmark: ['DK', 'DNK', 'Copenhagen', 'DKK', '+45'],
  Egypt: ['EG', 'EGY', 'Cairo', 'EGP', '+20'],
  Estonia: ['EE', 'EST', 'Tallinn', 'EUR', '+372'],
  Ethiopia: ['ET', 'ETH', 'Addis Ababa', 'ETB', '+251'],
  Finland: ['FI', 'FIN', 'Helsinki', 'EUR', '+358'],
  France: ['FR', 'FRA', 'Paris', 'EUR', '+33'],
  Germany: ['DE', 'DEU', 'Berlin', 'EUR', '+49'],
  Ghana: ['GH', 'GHA', 'Accra', 'GHS', '+233'],
  Greece: ['GR', 'GRC', 'Athens', 'EUR', '+30'],
  'Hong Kong': ['HK', 'HKG', 'Hong Kong', 'HKD', '+852'],
  Hungary: ['HU', 'HUN', 'Budapest', 'HUF', '+36'],
  Iceland: ['IS', 'ISL', 'Reykjavík', 'ISK', '+354'],
  India: ['IN', 'IND', 'New Delhi', 'INR', '+91'],
  Indonesia: ['ID', 'IDN', 'Jakarta', 'IDR', '+62'],
  Ireland: ['IE', 'IRL', 'Dublin', 'EUR', '+353'],
  Israel: ['IL', 'ISR', 'Jerusalem', 'ILS', '+972'],
  Italy: ['IT', 'ITA', 'Rome', 'EUR', '+39'],
  Japan: ['JP', 'JPN', 'Tokyo', 'JPY', '+81'],
  Jordan: ['JO', 'JOR', 'Amman', 'JOD', '+962'],
  Kenya: ['KE', 'KEN', 'Nairobi', 'KES', '+254'],
  Kuwait: ['KW', 'KWT', 'Kuwait City', 'KWD', '+965'],
  Latvia: ['LV', 'LVA', 'Riga', 'EUR', '+371'],
  Lithuania: ['LT', 'LTU', 'Vilnius', 'EUR', '+370'],
  Luxembourg: ['LU', 'LUX', 'Luxembourg', 'EUR', '+352'],
  Malaysia: ['MY', 'MYS', 'Kuala Lumpur', 'MYR', '+60'],
  Malta: ['MT', 'MLT', 'Valletta', 'EUR', '+356'],
  Mexico: ['MX', 'MEX', 'Mexico City', 'MXN', '+52'],
  Morocco: ['MA', 'MAR', 'Rabat', 'MAD', '+212'],
  Netherlands: ['NL', 'NLD', 'Amsterdam', 'EUR', '+31'],
  'New Zealand': ['NZ', 'NZL', 'Wellington', 'NZD', '+64'],
  Nigeria: ['NG', 'NGA', 'Abuja', 'NGN', '+234'],
  Norway: ['NO', 'NOR', 'Oslo', 'NOK', '+47'],
  Oman: ['OM', 'OMN', 'Muscat', 'OMR', '+968'],
  Pakistan: ['PK', 'PAK', 'Islamabad', 'PKR', '+92'],
  Peru: ['PE', 'PER', 'Lima', 'PEN', '+51'],
  Philippines: ['PH', 'PHL', 'Manila', 'PHP', '+63'],
  Poland: ['PL', 'POL', 'Warsaw', 'PLN', '+48'],
  Portugal: ['PT', 'PRT', 'Lisbon', 'EUR', '+351'],
  Qatar: ['QA', 'QAT', 'Doha', 'QAR', '+974'],
  Romania: ['RO', 'ROU', 'Bucharest', 'RON', '+40'],
  Russia: ['RU', 'RUS', 'Moscow', 'RUB', '+7'],
  'Saudi Arabia': ['SA', 'SAU', 'Riyadh', 'SAR', '+966'],
  Singapore: ['SG', 'SGP', 'Singapore', 'SGD', '+65'],
  Slovakia: ['SK', 'SVK', 'Bratislava', 'EUR', '+421'],
  Slovenia: ['SI', 'SVN', 'Ljubljana', 'EUR', '+386'],
  'South Africa': ['ZA', 'ZAF', 'Pretoria', 'ZAR', '+27'],
  'South Korea': ['KR', 'KOR', 'Seoul', 'KRW', '+82'],
  Spain: ['ES', 'ESP', 'Madrid', 'EUR', '+34'],
  'Sri Lanka': ['LK', 'LKA', 'Sri Jayawardenepura Kotte', 'LKR', '+94'],
  Sweden: ['SE', 'SWE', 'Stockholm', 'SEK', '+46'],
  Switzerland: ['CH', 'CHE', 'Bern', 'CHF', '+41'],
  Taiwan: ['TW', 'TWN', 'Taipei', 'TWD', '+886'],
  Thailand: ['TH', 'THA', 'Bangkok', 'THB', '+66'],
  Tunisia: ['TN', 'TUN', 'Tunis', 'TND', '+216'],
  Turkey: ['TR', 'TUR', 'Ankara', 'TRY', '+90'],
  Ukraine: ['UA', 'UKR', 'Kyiv', 'UAH', '+380'],
  'United Arab Emirates': ['AE', 'ARE', 'Abu Dhabi', 'AED', '+971'],
  'United Kingdom': ['GB', 'GBR', 'London', 'GBP', '+44'],
  'United States': ['US', 'USA', 'Washington, D.C.', 'USD', '+1'],
  Vietnam: ['VN', 'VNM', 'Hanoi', 'VND', '+84']
};

export const COUNTRIES = Object.fromEntries(
  Object.entries(K).map(([name, [iso2, iso3, capital, currency, dialCode]]) =>
    [name, { name, iso2, iso3, capital, currency, dialCode }])
);

/* The names people actually type, mapped to the table's own key. Kept separate
   from the table so the data stays readable as data. */
const ALIASES = {
  usa: 'United States', us: 'United States', america: 'United States',
  'united states of america': 'United States', 'the us': 'United States',
  uk: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', gb: 'United Kingdom', 'the uk': 'United Kingdom',
  holland: 'Netherlands', 'the netherlands': 'Netherlands',
  uae: 'United Arab Emirates', emirates: 'United Arab Emirates',
  korea: 'South Korea', 'republic of korea': 'South Korea',
  czechia: 'Czech Republic', 'czech republic': 'Czech Republic',
  türkiye: 'Turkey', turkiye: 'Turkey',
  'russian federation': 'Russia', 'south africa': 'South Africa',
  'new zealand': 'New Zealand', 'saudi': 'Saudi Arabia', 'viet nam': 'Vietnam'
};

/** Country by name, alias, ISO-2 or ISO-3. Case- and accent-insensitive. */
export function findCountry (query) {
  if (typeof query !== 'string') return null;
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return null;

  if (ALIASES[q]) return COUNTRIES[ALIASES[q]];
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const c of Object.values(COUNTRIES)) {
    if (norm(c.name) === q) return c;
  }
  const up = query.trim().toUpperCase();
  for (const c of Object.values(COUNTRIES)) {
    if (c.iso2 === up || c.iso3 === up) return c;
  }
  return null;
}
