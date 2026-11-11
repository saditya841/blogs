import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAnalysisSection, stripAnalysisHeading, parseEditor, editorMessages, evaluateEditorOutput,
} from '../../src/editor.js';

// Source notes: short, plain, and deliberately containing one number (12000) plus three names.
const NOTES = [
  'Odisha government approved the new scheme on Monday.',
  'The scheme gives 12000 rupees to each farmer.',
  'Chief Minister announced the plan in Bhubaneswar.',
  'The first payment will start next month.',
].join(' ');

const SOURCES = [{ title: 'Odisha scheme', url: 'https://example.com/odisha', text: NOTES, date: 1_800_000_000 }];

// 160+ Devanagari words, one exact analysis heading, no Latin names and no digits:
// so only a real problem (bad claim / invented number / missing analysis) can make it fail.
const BODY = `## मुख्य बात

ओडिशा सरकार ने सोमवार को नई योजना को मंजूरी दी है। इस योजना के तहत हर किसान को बारह हजार रुपये मिलेंगे। मुख्यमंत्री ने भुवनेश्वर में इस योजना की घोषणा की है। पहली किस्त अगले महीने से शुरू होगी। सरकार का कहना है कि इससे किसानों को सीधा फायदा होगा।

## योजना का विस्तार

योजना में पंजीकरण की प्रक्रिया सरल रखी गई है। किसान अपने नजदीकी कार्यालय में जाकर नाम दर्ज करा सकते हैं। सरकार ने कहा है कि सभी पात्र किसानों को योजना का लाभ मिलेगा। अधिकारियों ने जानकारी दी है कि भुगतान सीधे बैंक खाते में भेजा जाएगा। इससे बिचौलियों की भूमिका कम होगी।

## विश्लेषण

यह योजना राज्य के किसानों के लिए महत्वपूर्ण मानी जा रही है। सीधे बैंक खाते में भुगतान होने से पारदर्शिता बढ़ेगी। अगले महीने से शुरू होने वाली पहली किस्त से किसानों को राहत मिलने की उम्मीद है। आगे देखना होगा कि पंजीकरण प्रक्रिया कितनी आसान रहती है। सरकार को यह भी सुनिश्चित करना होगा कि सभी पात्र लोगों तक लाभ पहुंचे।`;

const CLAIMS = `CLAIM: Odisha government approved the new scheme on Monday || EVIDENCE: Odisha government approved the new scheme on Monday
CLAIM: The scheme gives 12000 rupees to each farmer || EVIDENCE: The scheme gives 12000 rupees to each farmer
CLAIM: Chief Minister announced the plan in Bhubaneswar || EVIDENCE: Chief Minister announced the plan in Bhubaneswar
CLAIM: The first payment will start next month || EVIDENCE: The first payment will start next month`;

const GOOD_OUTPUT = `CLAIMS:\n${CLAIMS}\nBODY:\n${BODY}`;

const ARTICLE = {
  title: 'Odisha scheme',
  summary: 'ओडिशा सरकार ने किसानों के लिए नई योजना को मंजूरी दी है।',
  body: 'पुराना छोटा मसौदा।',
};

describe('analysis section detection', () => {
  test('Hindi, English and romanised headings are all accepted', () => {
    assert.equal(hasAnalysisSection('## विश्लेषण\nकुछ बात'), true);
    assert.equal(hasAnalysisSection('## Analysis\nSomething'), true);
    assert.equal(hasAnalysisSection('## Vishleshan\nKuch baat'), true);
    assert.equal(hasAnalysisSection('## Virall Take\nKuch baat'), true);
  });

  test('a normal sub-heading is not mistaken for the analysis section', () => {
    assert.equal(hasAnalysisSection('## मुख्य बात\nकुछ बात'), false);
    assert.equal(hasAnalysisSection(''), false);
  });

  test('stripAnalysisHeading removes only the heading, not the analysis prose', () => {
    const out = stripAnalysisHeading('## विश्लेषण\nयह मायने रखता है।');
    assert.ok(!out.includes('##'));
    assert.ok(out.includes('यह मायने रखता है'));
  });
});

describe('parseEditor — editor AI output parsing', () => {
  test('CLAIMS before BODY: claims are collected and kept out of the body', () => {
    const text = `CLAIMS:\nCLAIM: A claim here || EVIDENCE: exact source words here\nCLAIM: Second claim || EVIDENCE: more source words\nBODY:\n## Mukhya baat\n\nPehla paragraph.\n\n- bullet item`;
    const p = parseEditor(text);
    assert.ok(p.claimText.includes('CLAIM: A claim here'));
    assert.ok(p.claimText.includes('CLAIM: Second claim'));
    assert.ok(p.body.includes('## Mukhya baat'));
    assert.ok(p.body.includes('Pehla paragraph'));
    assert.ok(p.body.includes('bullet item'));
    assert.ok(!p.body.includes('CLAIM'));
    assert.ok(!p.body.includes('EVIDENCE'));
    assert.ok(!/^-\s/m.test(p.body));
  });

  test('BODY before CLAIMS: body stops before the claim list', () => {
    const text = `BODY:\n## Heading\n\nText here.\n\nCLAIMS:\nCLAIM: A claim || EVIDENCE: source words here`;
    const p = parseEditor(text);
    assert.ok(p.body.includes('## Heading'));
    assert.ok(p.body.includes('Text here'));
    assert.ok(!p.body.includes('CLAIM'));
    assert.ok(!p.body.includes('EVIDENCE'));
    assert.ok(p.claimText.includes('CLAIM: A claim'));
  });

  test('markdown bold, quotes and odd heading levels are cleaned', () => {
    const p = parseEditor('BODY:\n# H1\n\n**bold** aur "quote"\n\n### H3');
    assert.ok(!p.body.includes('**'));
    assert.ok(!p.body.includes('"'));
    assert.ok(p.body.includes('## H1'));
    assert.ok(p.body.includes('## H3'));
    assert.ok(p.body.includes('bold'));
  });

  test('code fences and repeated TITLE/SUMMARY lines never reach the body', () => {
    const p = parseEditor('BODY:\nTITLE: Some title\nSUMMARY: One line.\n```markdown\n## Heading\n\nText.\n```');
    assert.ok(!p.body.includes('```'));
    assert.ok(!p.body.includes('TITLE:'));
    assert.ok(!p.body.includes('SUMMARY:'));
    assert.ok(p.body.includes('## Heading'));
    assert.ok(p.body.includes('Text.'));
  });
});

describe('evaluateEditorOutput — code decides, not the AI', () => {
  test('a fully grounded article passes', () => {
    const r = evaluateEditorOutput(GOOD_OUTPUT, ARTICLE, SOURCES);
    assert.equal(r.verified, true);
    assert.equal(r.claims, 4);
    assert.equal(r.supported, 4);
    assert.equal(r.unsupportedCount, 0);
    assert.equal(r.coverageLow, false);
    assert.equal(r.hasAnalysis, true);
    assert.deepEqual(r.numbersNotInSources, []);
    assert.deepEqual(r.latinNotInSources, []);
    assert.equal(r.body, BODY);
  });

  test('evidence that is not in the sources is rejected by groundedCheck', () => {
    const text = GOOD_OUTPUT.replace(
      'EVIDENCE: Odisha government approved the new scheme on Monday',
      'EVIDENCE: completely different words that never appear'
    );
    const r = evaluateEditorOutput(text, ARTICLE, SOURCES);
    assert.equal(r.verified, false);
    assert.equal(r.unsupportedCount, 1);
    assert.equal(r.claimList.filter((c) => !c.ok).length, 1);
  });

  test('a number that is not in the sources fails the whole check', () => {
    const text = GOOD_OUTPUT.replace('लाभ पहुंचे।', 'लाभ पहुंचे। सरकार ने 45 नए केंद्र खोलने की बात कही है।');
    const r = evaluateEditorOutput(text, ARTICLE, SOURCES);
    assert.equal(r.verified, false);
    assert.deepEqual(r.numbersNotInSources, ['45']);
  });

  test('too few claims are flagged as low coverage even when each claim is true', () => {
    const text = `CLAIMS:\nCLAIM: Odisha government approved the new scheme on Monday || EVIDENCE: Odisha government approved the new scheme on Monday\nBODY:\n${BODY}`;
    const r = evaluateEditorOutput(text, ARTICLE, SOURCES);
    assert.equal(r.claims, 1);
    assert.equal(r.coverageLow, true);
    assert.equal(r.verified, false);
  });

  test('a missing analysis section blocks verification', () => {
    const text = GOOD_OUTPUT.replace('## विश्लेषण', '## अन्य बात');
    const r = evaluateEditorOutput(text, ARTICLE, SOURCES);
    assert.equal(r.hasAnalysis, false);
    assert.equal(r.verified, false);
  });

  test('a broken short body falls back to the previous draft instead of publishing garbage', () => {
    const text = `BODY:\n## विश्लेषण\nबहुत छोटा।`;
    const r = evaluateEditorOutput(text, ARTICLE, SOURCES);
    assert.equal(r.body, ARTICLE.body);
  });

  test('English mode uses the English analysis heading in the prompt', () => {
    const msgs = editorMessages({ POST_LANG: 'en' }, ARTICLE, SOURCES);
    const user = msgs.find((m) => m.role === 'user').content;
    assert.ok(user.includes('## Analysis'));
    assert.ok(user.includes('English'));
    assert.ok(user.includes(NOTES.slice(0, 40)));
  });

  test('Hindi mode asks for the Devanagari analysis heading and includes source text', () => {
    const msgs = editorMessages({ POST_LANG: 'hi' }, ARTICLE, SOURCES);
    const user = msgs.find((m) => m.role === 'user').content;
    assert.ok(user.includes('## विश्लेषण'));
    assert.ok(user.includes('Hindi (Devanagari script)'));
    assert.ok(user.includes(NOTES));
  });
});
