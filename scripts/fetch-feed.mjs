// Robot d'agrégation RSS — Atlas ALISFA
// Exécuté toutes les 15 minutes par GitHub Actions (.github/workflows/feed.yml)
// Aggrège les flux publics liés à l'emploi-formation, à l'ESS et au droit social.
//
// IMPORTANT — sources : uniquement des flux RSS/Atom PUBLICS, pas de scraping de pages
// authentifiées. Aucune redistribution de contenu privé.

import { writeFile } from 'node:fs/promises';

// Sources RSS/Atom publics (à élargir si nouveaux flux trouvés)
const SOURCES = [
  // Service-public.fr — flux particuliers (très large, on filtrera par mots-clés)
  { name: 'Service-public', url: 'https://www.service-public.fr/particuliers/actualites.rss', keywords: ['formation', 'apprentissage', 'professionnel', 'CPF', 'VAE', 'reconversion', 'salarié', 'ESS', 'association'] },
  // Vie publique
  { name: 'Vie publique', url: 'https://www.vie-publique.fr/rss/actualite.xml', keywords: ['formation', 'apprentissage', 'professionnelle', 'travail', 'ESS', 'social', 'association', 'CPF'] },
  // Travail-emploi.gouv
  { name: 'Travail-emploi', url: 'https://travail-emploi.gouv.fr/rss/actualites.rss', keywords: ['formation', 'apprentissage', 'professionnelle', 'reconversion'] },
  // Localtis (Banque des Territoires)
  { name: 'Localtis', url: 'https://www.banquedesterritoires.fr/rss/actualites.xml', keywords: ['formation', 'ESS', 'social', 'association', 'emploi'] },
  // Avise (ESS)
  { name: 'Avise', url: 'https://www.avise.org/rss.xml', keywords: [] },
  // ESS France
  { name: 'ESS France', url: 'https://ess-france.org/fr/rss.xml', keywords: [] },
  // France compétences
  { name: 'France compétences', url: 'https://www.francecompetences.fr/feed/', keywords: [] },
];

const MAX_ITEMS = 24;
const MAX_PER_SOURCE = 5;
const MAX_TITLE_LEN = 140;

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function pickOne(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

function pickHrefAtom(xml) {
  const m = xml.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function parseFeed(xml, sourceName) {
  // RSS 2.0 : <item>, <title>, <link>, <pubDate>
  // Atom    : <entry>, <title>, <link href>, <updated>
  const isAtom = /<feed[\s>]/.test(xml);
  const itemTag = isAtom ? 'entry' : 'item';
  const dateTag = isAtom ? 'updated' : 'pubDate';
  return pickAll(xml, itemTag).map((raw) => {
    const title = decodeEntities(pickOne(raw, 'title'));
    const link = isAtom ? pickHrefAtom(raw) : decodeEntities(pickOne(raw, 'link'));
    const date = decodeEntities(pickOne(raw, dateTag) || pickOne(raw, 'published'));
    return {
      source: sourceName,
      title: title.length > MAX_TITLE_LEN ? title.slice(0, MAX_TITLE_LEN - 1) + '…' : title,
      link,
      date: date ? new Date(date).toISOString() : null,
    };
  }).filter(it => it.title && it.link);
}

function matchesKeywords(item, kw) {
  if (!kw || kw.length === 0) return true;
  const hay = item.title.toLowerCase();
  return kw.some(k => hay.includes(k.toLowerCase()));
}

async function fetchSource(src) {
  try {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': 'Atlas-ALISFA-Aggregator/1.0 (+github.com/0xZ1337/atlas-metiers-alisfa)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`✗ ${src.name} HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = parseFeed(xml, src.name).filter(it => matchesKeywords(it, src.keywords));
    console.log(`✓ ${src.name} : ${items.length} items pertinents`);
    return items.slice(0, MAX_PER_SOURCE);
  } catch (e) {
    console.warn(`✗ ${src.name} : ${e.message}`);
    return [];
  }
}

async function main() {
  console.log('▸ Atlas ALISFA — agrégation des flux RSS publics');
  console.log(`▸ ${SOURCES.length} sources configurées`);

  const results = await Promise.all(SOURCES.map(fetchSource));
  const all = results.flat();

  // Dédoublonnage par lien
  const seen = new Set();
  const unique = all.filter(it => {
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    return true;
  });

  // Tri par date desc
  unique.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  const items = unique.slice(0, MAX_ITEMS);

  const feed = {
    generated: new Date().toISOString(),
    source_count: SOURCES.length,
    item_count: items.length,
    note: 'Agrégation automatique — sources : flux RSS/Atom publics. Aucune information privée.',
    items,
  };

  await writeFile('feed.json', JSON.stringify(feed, null, 2) + '\n', 'utf8');
  console.log(`✓ feed.json écrit — ${items.length} items totaux`);
}

main().catch((e) => {
  console.error('✗ Échec :', e);
  process.exit(1);
});
