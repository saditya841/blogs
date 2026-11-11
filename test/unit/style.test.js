import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { styleCheck, splitSentences, BANNED_PHRASES, styleMeta } from '../../src/style.js';

const human = [
  'The state cabinet met on Tuesday and cleared the long-pending metro extension.',
  'Officials said the line will add nine stations between the old bus stand and the airport.',
  'Work is expected to start next month.',
  'Residents have mixed feelings, because construction will block the main road for almost three years and shopkeepers fear a drop in daily sales.',
  'दूसरी ओर, विपक्ष ने परियोजना की लागत पर सवाल उठाया।',
  'सरकार का कहना है कि हर खर्च का हिसाब सार्वजनिक किया जाएगा और निविदा प्रक्रिया पारदर्शी रहेगी।',
  'The next review meeting is scheduled for Friday, when the cabinet will look at the revised cost estimate and the land acquisition list.'
].join(' ');

describe('splitSentences', () => {
  test('splits Hindi and English sentences and drops headings', () => {
    const s = splitSentences('## Heading\n\nपहला वाक्य यहाँ है। दूसरा वाक्य यहाँ है. Third one here.');
    assert.equal(s.length, 3);
    assert.ok(!s.join(' ').includes('Heading'));
  });
});

describe('styleCheck — human-like writing guard', () => {
  test('varied, original prose gets full marks', () => {
    const r = styleCheck(human);
    assert.equal(r.penalty, 0, JSON.stringify(r.notes));
    assert.equal(r.score, 100);
    assert.ok(r.sentenceSd > 3);
  });

  test('stock AI phrases are caught and penalised', () => {
    const r = styleCheck(human + ' Furthermore, it is important to note that the project is a game-changer. In conclusion, the plan will revolutionize the city.');
    assert.ok(r.banned.includes('furthermore'));
    assert.ok(r.banned.includes('it is important to note'));
    assert.ok(r.penalty >= 12, `penalty=${r.penalty}`);
    assert.ok(r.notes.some((n) => /stock phrases/i.test(n)));
  });

  test('every sentence the same length is penalised (flat rhythm)', () => {
    const flat = Array.from({ length: 9 }, (_, i) => `This is a plain sentence number ${i} with exactly ten words in it.`).join(' ');
    const r = styleCheck(flat);
    assert.ok(r.penalty >= 9, `penalty=${r.penalty}`);
    assert.ok(r.notes.some((n) => /same lambai|rhythm/i.test(n)));
  });

  test('the same opening words again and again are penalised', () => {
    const rep = Array.from({ length: 8 }, (_, i) => `The government said point number ${i} is important for every citizen in the state today.`).join(' ');
    const r = styleCheck(rep);
    assert.ok(r.penalty >= 9, `penalty=${r.penalty}`);
    assert.ok(r.notes.some((n) => /shuruaati shabd|same opening/i.test(n)));
  });

  test('too little text is flagged', () => {
    const r = styleCheck('Ek chhota vakya.');
    assert.ok(r.penalty >= 10);
    assert.equal(r.sentences, 1);
  });

  test('empty input never crashes', () => {
    const r = styleCheck('');
    assert.equal(r.sentences, 0);
    assert.ok(r.penalty > 0);
  });

  test('meta is compact for check_json', () => {
    const m = styleMeta(styleCheck(human));
    assert.equal(m.score, 100);
    assert.equal(m.penalty, 0);
    assert.ok(Array.isArray(m.notes));
  });

  test('banned list has English and Hindi stock phrases', () => {
    assert.ok(BANNED_PHRASES.includes('furthermore'));
    assert.ok(BANNED_PHRASES.includes('इस लेख में'));
  });
});
