const { cleanText } = require('./normalizer');

function normalizeFeatureText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const FEATURE_ALIASES = {
  bar_molhado: ['bar molhado', 'bar na piscina', 'bar dentro da piscina', 'bar aquatico', 'wet bar'],
  aceita_pets: ['pet', 'pets', 'aceita pet', 'aceita pets', 'animais', 'animais de estimacao', 'cachorro', 'gato', 'pet friendly']
};

function resolveFeature(value) {
  const normalized = normalizeFeatureText(value);
  return Object.entries(FEATURE_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] || null;
}

function evidenceForFeature(description, feature) {
  const source = cleanText(description);
  const pattern = feature === 'bar_molhado'
    ? /\b(?:bar molhado|bar na piscina|bar dentro da piscina|bar aquatico|wet bar)\b/
    : feature === 'aceita_pets'
      ? /\b(?:(?:permite|aceita|permitido|permitidos|permitida|permitidas)\s+(?:animais|pets?|cachorros?|gatos?)|(?:animais|pets?|cachorros?|gatos?)\s+(?:permitidos?|aceitos?)|pet friendly)\b/
      : null;
  if (!pattern) return null;
  for (const clause of source.split(/[✓✗↓•\n.;,]+|\b(?:mas|por[eé]m|contudo)\b/iu)) {
    const normalized = normalizeFeatureText(clause);
    const match = pattern.exec(normalized);
    if (!match) continue;
    const prefix = normalized.slice(0, match.index);
    const suffix = normalized.slice(match.index + match[0].length);
    if (/\b(?:nao|nunca|sem|proibido|proibida|vedado|vedada)\b/.test(prefix)) continue;
    if (/\b(?:indisponivel|desativado|desativada|fechado|fechada|em reforma)\b/.test(suffix)) continue;
    return clause.trim().slice(0, 300);
  }
  return null;
}

module.exports = { resolveFeature, evidenceForFeature };
