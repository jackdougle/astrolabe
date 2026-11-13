// Typing shorthand in the rendered view: -- becomes an em dash, and -> and its kin become arrows, as they are
// typed. Backspace straight after a swap puts back what was typed.
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { $prose } from '@milkdown/kit/utils';

/** What is typed and what it becomes; the first that fits wins. A longer shorthand is reached through the
 *  shorter one inside it, so some start from what an earlier swap made (-- then > is — then >). */
const SWAPS: [RegExp, string][] = [
  [/(?:—|--)>$/, '⟶'],  // -->
  [/⟵>$/, '⟷'],         // <-->
  [/←>$/, '↔'],          // <->
  [/←-$/, '⟵'],         // <--
  [/<-$/, '←'],
  [/->$/, '→'],
  [/(?<!-)--$/, '—'],    // --- is left to the rule that draws a line
  [/⟸>$/, '⟺'],        // <==>
  [/<=>$/, '⇔'],
  [/<==$/, '⟸'],
  [/==>$/, '⟹'],
  [/=>$/, '⇒'],
];

export const symbolRules = $prose(() => inputRules({ rules: [
  // --- opening a line still draws a line across: its first two dashes are an em dash by the time the third comes.
  new InputRule(/^—-$/, (state, _match, start, end) => {
    const hr = state.schema.nodes.hr;
    if (!hr || state.doc.resolve(start).parent.type.name !== 'paragraph') return null;
    return state.tr.replaceWith(start - 1, end, hr.create());
  }),
  ...SWAPS.map(([typed, becomes]) => new InputRule(typed, (state, match, start, end) => {
    const code = state.schema.marks.inlineCode;
    if (code && state.doc.rangeHasMark(start, end, code)) return null;
    // Nor in code still being typed (a ` not yet closed), nor inside an HTML comment, whose <!-- and --> are meant as typed.
    const $start = state.doc.resolve(start);
    const upto = $start.parent.textBetween(0, $start.parentOffset, undefined, '￼') + match[0];
    if ((upto.split('`').length - 1) % 2 || upto.lastIndexOf('<!--') > upto.lastIndexOf('-->')) return null;
    // Nor in an address: a link's target as it is typed, or a bare one.
    if (/(?:\]\(|\bhttps?:\/\/)\S*$/.test(upto)) return null;
    // A < brought its > with it (see the pairs); a left arrow takes that along.
    const closer = match[0][0] === '<' && becomes !== '⇔' && state.doc.textBetween(end, Math.min(end + 1, $start.end())) === '>';
    return state.tr.insertText(becomes, start, closer ? end + 1 : end);
  })),
] }));
