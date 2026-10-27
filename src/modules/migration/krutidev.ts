/**
 * §15 step 2: Hindi names in FoxPro are usually typed in the Kruti Dev 010 font — plain Windows-1252 letters that only
 * look like Devanagari on screen ("jkds'k" shows as राकेश). This turns them into Unicode.
 *
 * Kruti Dev types the short i (ि) before its consonant and the reph (र्) after its syllable; Unicode wants both the
 * other way round, so they are moved after the letters are swapped. Longest sequences are replaced first.
 */
const PRE_I = "";
const REPH = "";

// [Kruti Dev, Unicode]. A half letter followed by "k" (the ा stem) is how Kruti Dev types most full letters ("[k" = ख),
// so half forms map to "letter + ्" and "्ा" is folded away afterwards; only independent vowels need their own pairs.
const PAIRS: [string, string][] = [
  // independent vowels
  ["vkS", "औ"], ["vks", "ओ"], ["vk", "आ"], ["v‚", "ऑ"], ["v", "अ"],
  ["bZ", "ई"], ["Ã", "ई"], ["b", "इ"], ["m", "उ"], ["Å", "ऊ"], [",s", "ऐ"], [",", "ए"], ["_", "ऋ"],
  // conjuncts and special forms
  ["{", "क्ष्"], ["=", "त्र"], ["«", "त्र्"], ["K", "ज्ञ"], ["J", "श्र"], ["}", "द्व"], ["|", "द्य"],
  ["Ø", "क्र"], ["æ", "द्र"], ["ç", "प्र"], ["Ù", "त्त"], ["–", "दृ"], ["—", "कृ"], ["é", "न्न"], ["™", "न्न्"],
  ["à", "ह्न"], ["á", "ह्य"], ["â", "हृ"], ["ã", "ह्म"], ["º", "ह्"], ["í", "द्द"], ["ô", "क्क"], ["ê", "ट्ट"], ["ë", "ट्ठ"], ["ì", "ड्ड"], ["ï", "ड्ढ"],
  ["Vª", "ट्र"], ["Mª", "ड्र"], ["Nª", "छ्र"], [")", "द्ध"], ["#", "रु"], [":", "रू"], ["Ý", "फ्र"],
  // nukta forms
  ["d+", "क़"], ["[+", "ख़्"], ["x+", "ग़"], ["t+", "ज़"], ["T+", "ज़्"], ["M+", "ड़"], ["<+", "ढ़"], ["Q+", "फ़"], ["¶+", "फ़्"],
  // consonants: full forms, then half forms (letter + ्)
  ["d", "क"], ["D", "क्"], ["[", "ख्"], ["x", "ग"], ["X", "ग्"], ["?", "घ्"], ["³", "ङ"],
  ["p", "च"], ["P", "च्"], ["N", "छ"], ["t", "ज"], ["T", "ज्"], [">", "झ"], ["÷", "झ्"], ["¥", "ञ"],
  ["V", "ट"], ["B", "ठ"], ["M", "ड"], ["<", "ढ"], [".", "ण्"],
  ["r", "त"], ["R", "त्"], ["F", "थ्"], ["n", "द"], ["/", "ध्"], ["è", "ध्"], ["u", "न"], ["U", "न्"],
  ["i", "प"], ["I", "प्"], ["Q", "फ"], ["¶", "फ्"], ["c", "ब"], ["C", "ब्"], ["H", "भ्"], ["e", "म"], ["E", "म्"],
  [";", "य"], ["¸", "य्"], ["j", "र"], ["y", "ल"], ["Y", "ल्"], ["G", "ळ"], ["o", "व"], ["O", "व्"],
  ["'", "श्"], ['"', "ष्"], ["l", "स"], ["L", "स्"], ["g", "ह"],
  // vowel signs and marks
  ["ks", "ो"], ["kS", "ौ"], ["k", "ा"], ["h", "ी"], ["q", "ु"], ["w", "ू"], ["`", "ृ"], ["s", "े"], ["S", "ै"], ["‚", "ॉ"], ["W", "ॅ"],
  ["a", "ं"], ["¡", "ँ"], ["%", "ः"], ["z", "्र"], ["~", "्"], ["+", "़"], ["A", "।"], ["Z", REPH], ["f", PRE_I], ["Ê", "ीं"], ["È", "ीं"],
];

// One pass, longest match first at each position (so "vks" wins over "vk" and "v").
const MAX = Math.max(...PAIRS.map(([k]) => k.length));
const TABLE = new Map(PAIRS);

const CONSONANT = /[\u0915-\u0939\u0958-\u095F]/;
// Dependent vowel signs, candrabindu, anusvara, visarga and nukta.
const SIGN = /[\u093E-\u094C\u0962\u0963\u0901-\u0903\u093C]/;

function moveShortI(s: string): string {
  // ि before a consonant cluster (half consonants, then a full one, maybe a nukta) goes after the cluster.
  let out = s;
  for (let i = out.indexOf(PRE_I); i >= 0; i = out.indexOf(PRE_I, i + 1)) {
    let j = i + 1;
    while (j + 1 < out.length && CONSONANT.test(out[j]) && out[j + 1] === "्") j += 2;
    if (j < out.length && CONSONANT.test(out[j])) {
      j++;
      if (out[j] === "़") j++;
      // A rakar (्र) typed after the consonant stays with it.
      if (out[j] === "्" && out[j + 1] === "र") j += 2;
      out = out.slice(0, i) + out.slice(i + 1, j) + "ि" + out.slice(j);
      i = j - 1;
    } else out = out.slice(0, i) + "ि" + out.slice(i + 1);
  }
  return out;
}

function moveReph(s: string): string {
  // र् typed after its syllable goes before it: back over vowel signs, the consonant, and any half consonants before it.
  let out = s;
  for (let i = out.indexOf(REPH); i >= 0; i = out.indexOf(REPH)) {
    let j = i - 1;
    while (j >= 0 && SIGN.test(out[j])) j--;
    if (j >= 0 && out[j] === "़") j--;
    if (j >= 0 && CONSONANT.test(out[j])) {
      while (j - 2 >= 0 && out[j - 1] === "्" && CONSONANT.test(out[j - 2])) j -= 2;
      out = out.slice(0, j) + "र्" + out.slice(j, i) + out.slice(i + 1);
    } else out = out.slice(0, i) + "र्" + out.slice(i + 1);
  }
  return out;
}

export function krutiToUnicode(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; ) {
    let hit = false;
    for (let n = Math.min(MAX, input.length - i); n > 0; n--) {
      const u = TABLE.get(input.slice(i, i + n));
      if (u !== undefined) {
        out += u;
        i += n;
        hit = true;
        break;
      }
    }
    if (!hit) out += input[i++];
  }
  // Half letter + the ा stem = the full letter (ख् + ा = ख; with ो / ौ the stem is part of the sign).
  out = out.replace(/्ा/g, "").replace(/्([ोौ])/g, "$1");
  return moveReph(moveShortI(out)).normalize("NFC");
}

/** True when a text looks like Kruti Dev rather than English (used to suggest the conversion on the mapping screen). */
export function looksLikeKruti(s: string): boolean {
  const t = s.trim();
  if (!t || /[ऀ-ॿ]/.test(t)) return false;
  // English names are mostly lower-case vowels between consonants; Kruti text is full of k, s, h, q and quote marks.
  const marks = (t.match(/[kshqw;'"`\[\]{}]/g) ?? []).length;
  const vowels = (t.match(/[aeiou]/gi) ?? []).length;
  return marks >= Math.max(2, t.replace(/\s/g, "").length * 0.25) && vowels < marks;
}
