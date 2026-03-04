/**
 * NCAAM team slug → ESPN team ID map.
 * Used to build ESPN CDN logo URLs directly without a DB/API call.
 * Logo URL: https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/{id}.png&scale=crop&cquality=40&location=origin&w=80&h=80
 *
 * IDs sourced from ESPN public API (site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams)
 * and validated against the ESPN CDN (all return HTTP 200).
 */

export const NCAAM_ESPN_IDS: Record<string, string> = {
  // A
  air_force: "2005",
  akron: "2006",
  alabama: "333",
  appalachian_state: "2026",
  arizona: "12",
  arizona_state: "9",
  arkansas: "8",
  arkansas_state: "2032",
  army: "349",
  auburn: "2",

  // B
  ball_state: "2050",
  baylor: "239",
  belmont: "2057",
  boise_state: "68",
  boston_college: "103",
  bowling_green: "189",
  bradley: "71",
  bucknell: "2083",
  buffalo: "2084",
  butler: "2086",
  byu: "252",

  // C
  california: "25",
  campbell: "2097",
  canisius: "2099",
  central_florida: "2116",
  central_michigan: "2117",
  charlotte: "2429",
  cincinnati: "2132",
  clemson: "228",
  cleveland_state: "325",
  coastal_carolina: "324",
  college_of_charleston: "232",
  colorado: "38",
  colorado_state: "36",

  // D
  davidson: "2166",
  dayton: "2168",
  depaul: "305",
  drake: "2181",
  drexel: "2182",
  duke: "150",

  // E
  east_carolina: "151",
  eastern_michigan: "2199",
  eastern_washington: "331",
  elon: "2210",
  evansville: "339",

  // F
  fairfield: "2217",
  florida: "57",
  florida_atlantic: "2226",
  florida_international: "2229",
  fresno_state: "278",

  // G
  george_mason: "2244",
  georgetown: "46",
  georgia: "61",
  georgia_southern: "290",
  georgia_state: "2247",
  gonzaga: "2250",
  grand_canyon: "2253",

  // H
  hampton: "2261",
  hofstra: "2275",
  holy_cross: "107",
  houston: "248",

  // I
  idaho: "70",
  idaho_state: "304",
  illinois: "356",
  illinois_chicago: "82",
  illinois_state: "2287",
  indiana: "84",
  indiana_state: "282",
  iona: "314",
  iowa: "2294",
  iowa_state: "66",
  iupui: "2870",

  // K
  kansas: "2305",
  kansas_state: "2306",
  kent_state: "2309",
  kentucky: "96",

  // L
  la_salle: "2325",
  lafayette: "322",
  louisiana: "309",
  louisiana_monroe: "2433",
  louisiana_tech: "2348",
  louisville: "97",
  lsu: "99",

  // M
  manhattan: "2363",
  marist: "2368",
  marquette: "269",
  maryland: "120",
  massachusetts: "113",
  memphis: "235",
  merrimack: "2771",
  miami: "2390",
  miami_ohio: "193",
  michigan: "130",
  michigan_state: "127",
  minnesota: "135",
  mississippi: "145",
  mississippi_state: "344",
  missouri: "142",
  monmouth: "2405",
  montana: "149",
  montana_state: "147",
  mount_st_marys: "116",
  murray_state: "93",

  // N
  navy: "2426",
  nc_state: "152",
  nc_wilmington: "350",
  nebraska: "158",
  nevada: "2440",
  new_mexico: "167",
  niagara: "315",
  north_carolina: "153",
  north_carolina_at: "2448",
  north_texas: "249",
  northeastern: "111",
  northern_arizona: "2464",
  northern_colorado: "2458",
  northern_illinois: "2459",
  northern_iowa: "2460",
  northwestern: "77",
  notre_dame: "87",

  // O
  ohio: "195",
  ohio_state: "194",
  oklahoma: "201",
  oklahoma_state: "197",
  old_dominion: "295",
  oral_roberts: "2497",
  oregon: "2483",
  oregon_state: "204",

  // P
  penn_state: "213",
  pittsburgh: "221",
  portland_state: "2502",
  purdue: "2509",

  // Q
  quinnipiac: "2514",

  // R
  rice: "242",
  richmond: "257",
  rider: "2520",
  rutgers: "164",

  // S
  sacramento_state: "16",
  saint_josephs: "2603",
  saint_louis: "139",
  saint_marys: "2608",
  saint_peters: "2612",
  sam_houston: "2534",
  san_diego_state: "21",
  san_francisco: "2539",
  san_jose_state: "23",
  seton_hall: "2550",
  siena: "2561",
  smu: "2567",
  south_alabama: "6",
  south_carolina: "2579",
  south_florida: "58",
  southern_illinois: "79",
  southern_miss: "2572",
  stanford: "24",
  stony_brook: "2619",
  syracuse: "183",
  st_bonaventure: "179",
  st_johns: "2599",

  // T
  tcu: "2628",
  temple: "218",
  tennessee: "2633",
  texas: "251",
  texas_am: "245",
  texas_state: "326",
  texas_tech: "2641",
  toledo: "2649",
  towson: "119",
  troy: "2653",
  tulane: "2655",
  tulsa: "202",

  // U
  uab: "5",
  ucla: "26",
  unlv: "2439",
  usc: "30",
  utah: "254",
  utah_state: "328",
  utah_tech: "3101",
  utsa: "2636",

  // V
  vanderbilt: "238",
  vcu: "2670",
  villanova: "222",
  virginia: "258",
  virginia_tech: "259",

  // W
  wake_forest: "154",
  washington: "264",
  washington_state: "265",
  weber_state: "2692",
  west_virginia: "277",
  western_michigan: "2711",
  wichita_state: "2724",
  william_and_mary: "2729",
  wisconsin: "275",
  wyoming: "2751",

  // X
  xavier: "2752",

  // March 4 WagerTalk additions (new teams not already in map above)
  bellarmine: "91",
  central_connecticut: "2115",
  chicago_state: "2130",
  creighton: "156",
  detroit_mercy: "2174",
  duquesne: "2184",
  eastern_illinois: "2197",
  eastern_kentucky: "2198",
  fairleigh_dickinson: "161",
  florida_gulf_coast: "2296",
  florida_state: "52",
  fordham: "2230",
  gardner_webb: "2241",
  george_washington: "45",
  georgia_tech: "59",
  jacksonville: "294",
  james_madison: "256",
  le_moyne: "2330",
  lindenwood: "2934",
  little_rock: "2031",
  liu: "112358",
  mercyhurst: "2385",
  miami_fl: "2390",
  milwaukee: "270",
  north_alabama: "2453",
  north_florida: "2454",
  northern_kentucky: "94",
  oakland: "2473",
  providence: "2507",
  rhode_island: "227",
  robert_morris: "2523",
  siu_edwardsville: "2565",
  south_carolina_upstate: "2908",
  st_josephs: "2603",
  stetson: "56",
  stonehill: "284",
  umkc: "140",
  wagner: "2681",
  west_georgia: "2698",
  wright_state: "2750",
  youngstown_state: "2754",
};

/**
 * Build an ESPN CDN logo URL for a given team slug.
 * Returns null if the team is not in the map.
 */
export function getEspnLogoUrl(slug: string, size = 80): string | null {
  const id = NCAAM_ESPN_IDS[slug];
  if (!id) return null;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${id}.png&scale=crop&cquality=40&location=origin&w=${size}&h=${size}`;
}
