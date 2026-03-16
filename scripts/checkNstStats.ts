import { scrapeNhlTeamStats } from '../server/nhlNaturalStatScraper';

async function main() {
  console.log('Scraping NST team stats...');
  const stats = await scrapeNhlTeamStats();
  const teams = ['STL', 'WPG', 'ANA', 'MTL', 'TOR', 'MIN', 'FLA', 'SEA', 'NSH', 'EDM'];
  
  // Compute actual league averages from scraped data
  const allTeamStats = Array.from(stats.values());
  const n = allTeamStats.length;
  const avgXGF  = allTeamStats.reduce((s, t) => s + t.xGF_60,  0) / n;
  const avgHDCF = allTeamStats.reduce((s, t) => s + t.HDCF_60, 0) / n;
  const avgSCF  = allTeamStats.reduce((s, t) => s + t.SCF_60,  0) / n;
  const avgCF   = allTeamStats.reduce((s, t) => s + t.CF_60,   0) / n;
  const avgXGA  = allTeamStats.reduce((s, t) => s + t.xGA_60,  0) / n;
  const avgHDCA = allTeamStats.reduce((s, t) => s + t.HDCA_60, 0) / n;
  const avgSCA  = allTeamStats.reduce((s, t) => s + t.SCA_60,  0) / n;
  const avgCA   = allTeamStats.reduce((s, t) => s + t.CA_60,   0) / n;
  
  console.log(`\nActual league averages (${n} teams):`);
  console.log(`  xGF/60=${avgXGF.toFixed(3)} HDCF/60=${avgHDCF.toFixed(3)} SCF/60=${avgSCF.toFixed(3)} CF/60=${avgCF.toFixed(3)}`);
  console.log(`  xGA/60=${avgXGA.toFixed(3)} HDCA/60=${avgHDCA.toFixed(3)} SCA/60=${avgSCA.toFixed(3)} CA/60=${avgCA.toFixed(3)}`);

  console.log('\nTeam | xGF | HDCF | SCF | CF | xGA | HDCA | SCA | CA | OFF | DEF | mu_raw');
  for (const abbrev of teams) {
    const s = stats.get(abbrev);
    if (s) {
      const off = (
        0.40 * (s.xGF_60  / avgXGF)  +
        0.25 * (s.HDCF_60 / avgHDCF) +
        0.20 * (s.SCF_60  / avgSCF)  +
        0.15 * (s.CF_60   / avgCF)
      );
      const def = (
        0.40 * (avgXGA  / Math.max(s.xGA_60,  0.01)) +
        0.30 * (avgHDCA / Math.max(s.HDCA_60, 0.01)) +
        0.30 * (avgSCA  / Math.max(s.SCA_60,  0.01))
      );
      const offC = Math.max(0.50, Math.min(2.00, off));
      const defC = Math.max(0.50, Math.min(2.00, def));
      const muRaw = 3.05 * offC * defC;
      console.log(`${abbrev}: xGF=${s.xGF_60.toFixed(2)} HDCF=${s.HDCF_60.toFixed(2)} SCF=${s.SCF_60.toFixed(2)} CF=${s.CF_60.toFixed(2)} | xGA=${s.xGA_60.toFixed(2)} HDCA=${s.HDCA_60.toFixed(2)} SCA=${s.SCA_60.toFixed(2)} CA=${s.CA_60.toFixed(2)} | OFF=${offC.toFixed(3)} DEF=${defC.toFixed(3)} | mu_raw=${muRaw.toFixed(3)}`);
    } else {
      console.log(`${abbrev}: NOT FOUND`);
    }
  }
}

main().catch(console.error);
