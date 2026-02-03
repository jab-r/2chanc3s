/**
 * Search Query Parser
 *
 * Parses search input into structured tokens for querying posts.
 *
 * Supported tokens:
 * - #hashtag  → lowercase, deduplicated
 * - @mention  → case-sensitive, deduplicated
 * - 📍location → quoted or unquoted place names
 * - plain text → remaining content for substring search
 */

const LOCATION_MARKER = '📍';

/**
 * Parse location name after 📍 marker
 * Handles quoted ("place name") and unquoted (place name) forms
 *
 * Delimiters for unquoted: newline, double space, punctuation, token starts (@#📍), URL starts
 *
 * @param {string} input - String starting with 📍
 * @returns {{ name: string, quoted: boolean, consumed: number }}
 */
function parseLocation(input) {
  const markerLen = LOCATION_MARKER.length;
  let pos = markerLen;

  // Skip leading whitespace (single spaces only, double space is delimiter)
  while (pos < input.length && input[pos] === ' ' && input[pos + 1] !== ' ') {
    pos++;
  }

  // Check for quoted form
  if (input[pos] === '"') {
    pos++; // skip opening quote
    let name = '';
    while (pos < input.length) {
      if (input[pos] === '\\' && input[pos + 1] === '"') {
        // Escaped quote
        name += '"';
        pos += 2;
      } else if (input[pos] === '\\' && input[pos + 1] === '\\') {
        // Escaped backslash
        name += '\\';
        pos += 2;
      } else if (input[pos] === '"') {
        pos++; // skip closing quote
        break;
      } else {
        name += input[pos];
        pos++;
      }
    }
    return { name: name.trim(), quoted: true, consumed: pos };
  }

  // Unquoted form - read until delimiter
  let name = '';

  while (pos < input.length) {
    const char = input[pos];
    const remaining = input.slice(pos);

    // Check for delimiters
    if (
      char === '\n' ||
      remaining.startsWith('  ') ||  // double space
      /^[.,;:!?)\]}]/.test(char) ||
      char === '@' ||
      char === '#' ||
      remaining.startsWith(LOCATION_MARKER) ||
      /^https?:\/\//.test(remaining)
    ) {
      break;
    }

    name += char;
    pos++;
  }

  return { name: name.trim(), quoted: false, consumed: pos };
}

/**
 * Parse search query into structured tokens and entities
 *
 * @param {string} input - Raw search string
 * @returns {ParsedQuery}
 *
 * @typedef {Object} ParsedQuery
 * @property {string} raw - Original input
 * @property {Token[]} tokens - Parsed tokens in order
 * @property {QueryEntities} entities - Deduplicated entities for querying
 *
 * @typedef {Object} Token
 * @property {'hashtag'|'mention'|'location'|'text'} type
 * @property {string} value - The extracted value
 * @property {number} start - Start position in input
 * @property {number} end - End position in input
 * @property {boolean} [quoted] - For location tokens, whether it was quoted
 *
 * @typedef {Object} QueryEntities
 * @property {string[]} hashtags - Lowercase, deduplicated
 * @property {string[]} mentions - Case-sensitive, deduplicated
 * @property {LocationRef[]} locations - Location references
 * @property {string|null} text - Combined plain text for substring search
 *
 * @typedef {Object} LocationRef
 * @property {string} name - Location name
 * @property {boolean} quoted - Whether it was quoted
 */
export function parseSearchQuery(input) {
  if (!input || typeof input !== 'string') {
    return {
      raw: '',
      tokens: [],
      entities: {
        hashtags: [],
        mentions: [],
        locations: [],
        text: null
      }
    };
  }

  const tokens = [];
  const hashtagSet = new Set();
  const mentionSet = new Set();
  const locations = [];
  const textFragments = [];

  let pos = 0;
  let textBuffer = '';

  function flushText() {
    const trimmed = textBuffer.trim();
    if (trimmed) {
      tokens.push({
        type: 'text',
        value: textBuffer,
        start: pos - textBuffer.length,
        end: pos
      });
      textFragments.push(trimmed);
    }
    textBuffer = '';
  }

  while (pos < input.length) {
    const char = input[pos];
    const remaining = input.slice(pos);

    // Check for hashtag
    if (char === '#') {
      const match = remaining.match(/^#([a-zA-Z0-9_]{1,50})/);
      if (match) {
        flushText();
        const value = match[1].toLowerCase(); // Hashtags are lowercase
        tokens.push({
          type: 'hashtag',
          value: value,
          start: pos,
          end: pos + match[0].length
        });
        hashtagSet.add(value);
        pos += match[0].length;
        continue;
      }
    }

    // Check for mention
    if (char === '@') {
      const match = remaining.match(/^@([a-zA-Z0-9_]{1,30})/);
      if (match) {
        flushText();
        const value = match[1]; // Mentions preserve case
        tokens.push({
          type: 'mention',
          value: value,
          start: pos,
          end: pos + match[0].length
        });
        mentionSet.add(value);
        pos += match[0].length;
        continue;
      }
    }

    // Check for location marker (📍 is a multi-byte character)
    if (remaining.startsWith(LOCATION_MARKER)) {
      flushText();
      const locationResult = parseLocation(remaining);
      if (locationResult.name) {
        tokens.push({
          type: 'location',
          value: locationResult.name,
          quoted: locationResult.quoted,
          start: pos,
          end: pos + locationResult.consumed
        });
        locations.push({
          name: locationResult.name,
          quoted: locationResult.quoted
        });
      }
      pos += locationResult.consumed;
      continue;
    }

    // Accumulate text
    textBuffer += char;
    pos++;
  }

  // Flush any remaining text
  flushText();

  // Combine text fragments
  const combinedText = textFragments.join(' ').replace(/\s+/g, ' ').trim();

  return {
    raw: input,
    tokens,
    entities: {
      hashtags: Array.from(hashtagSet),
      mentions: Array.from(mentionSet),
      locations,
      text: combinedText || null
    }
  };
}

/**
 * Check if the parsed query has any searchable filters
 *
 * @param {QueryEntities} entities
 * @returns {boolean}
 */
export function hasSearchFilters(entities) {
  return (
    entities.hashtags.length > 0 ||
    entities.mentions.length > 0 ||
    entities.locations.length > 0 ||
    (entities.text && entities.text.length >= 2)
  );
}
